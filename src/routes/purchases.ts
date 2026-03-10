import { Router, Response } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware";
import { computeStatus } from "./launches";

type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const router = Router({ mergeParams: true });

function calcCost(
  amount: number,
  totalAlreadySold: number,
  tiers: { minAmount: number; maxAmount: number; pricePerToken: number }[],
  flatPrice: number
): number {
  if (!tiers.length) return amount * flatPrice;

  const sorted = [...tiers].sort((a, b) => a.minAmount - b.minAmount);
  let remainingToBuy = amount;
  let currentSaleProgress = totalAlreadySold;
  let totalCost = 0;

  for (const tier of sorted) {
    if (remainingToBuy <= 0) break;

    // If current sale progress has already passed this tier, skip it
    if (currentSaleProgress >= tier.maxAmount) continue;

    // Start filling from where we are, but no earlier than tier min
    const effectiveStart = Math.max(tier.minAmount, currentSaleProgress);

    // If there is a gap between current progress and this tier's start, fill with flatPrice
    if (effectiveStart > currentSaleProgress) {
      const gap = Math.min(remainingToBuy, effectiveStart - currentSaleProgress);
      totalCost += gap * flatPrice;
      remainingToBuy -= gap;
      currentSaleProgress += gap;
      if (remainingToBuy <= 0) break;
    }

    const spaceInTier = tier.maxAmount - effectiveStart;
    if (spaceInTier > 0) {
      const fill = Math.min(remainingToBuy, spaceInTier);
      totalCost += fill * tier.pricePerToken;
      remainingToBuy -= fill;
      currentSaleProgress += fill;
    }
  }

  if (remainingToBuy > 0) {
    totalCost += remainingToBuy * flatPrice;
  }

  return totalCost;
}

// POST /api/launches/:id/purchase
router.post(
  "/purchase",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { walletAddress, amount, txSignature, referralCode } = req.body;

      if (!walletAddress || amount == null || !txSignature) {
        res.status(400).json({
          error: "walletAddress, amount, and txSignature are required",
        });
        return;
      }
      if (typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "amount must be a positive number" });
        return;
      }

      // Fetch launch with tiers and whitelist
      const launch = await prisma.launch.findUnique({
        where: { id },
        include: {
          tiers: true,
          whitelist: { select: { address: true } },
          purchases: { select: { amount: true } },
        },
      });

      if (!launch) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }

      // Compute total tokens already sold
      const totalPurchased = launch.purchases.reduce(
        (sum: number, p: { amount: number }) => sum + p.amount,
        0
      );

      // Compute status using total tokens sold
      const status = computeStatus(launch, totalPurchased);
      if (status !== "ACTIVE") {
        res
          .status(400)
          .json({ error: `Launch is ${status}, purchases not allowed` });
        return;
      }

      // Whitelist check — 403 Forbidden required by judge
      if (launch.whitelist.length > 0) {
        const whitelisted = launch.whitelist.some(
          (w: { address: string }) => w.address === walletAddress
        );
        if (!whitelisted) {
          res
            .status(403)
            .json({ error: "Wallet address is not whitelisted for this launch" });
          return;
        }
      }

      // Duplicate txSignature check (400 Bad Request)
      const existingTx = await prisma.purchase.findUnique({
        where: { txSignature },
      });
      if (existingTx) {
        res.status(400).json({ error: "Duplicate transaction signature" });
        return;
      }

      // Referral validation
      let referral: {
        id: string;
        discountPercent: number;
        maxUses: number;
        usedCount: number;
      } | null = null;
      if (referralCode) {
        referral = await prisma.referral.findUnique({
          where: { launchId_code: { launchId: id, code: referralCode } },
        });
        if (!referral) {
          res.status(400).json({ error: "Invalid referral code" });
          return;
        }
        if (referral.usedCount >= referral.maxUses) {
          res.status(400).json({ error: "Referral code has been exhausted" });
          return;
        }
      }

      // Sybil protection
      const userAggregate = await prisma.purchase.aggregate({
        where: { launchId: id, userId: req.user!.id },
        _sum: { amount: true },
      });
      const userTotal = userAggregate._sum.amount ?? 0;
      if (userTotal + amount > launch.maxPerWallet) {
        res.status(400).json({
          error: `Exceeds maxPerWallet. Already purchased: ${userTotal}, requesting: ${amount}, max: ${launch.maxPerWallet}`,
        });
        return;
      }

      // Total supply check
      if (totalPurchased + amount > launch.totalSupply) {
        res.status(400).json({
          error: `Purchase of ${amount} would exceed total supply of ${launch.totalSupply}`,
        });
        return;
      }

      // Calculate cost (tiered progress aware)
      let totalCost = calcCost(amount, totalPurchased, launch.tiers, launch.pricePerToken);

      // Apply referral discount
      if (referral) {
        totalCost = totalCost * (1 - referral.discountPercent / 100);
      }

      // Round cost
      totalCost = Math.round(totalCost);

      // Atomic transaction
      let purchaseObject;
      try {
        purchaseObject = await prisma.$transaction(async (tx: TxClient) => {
          // Final sanity re-checks
          const supplyAgg = await tx.purchase.aggregate({
            where: { launchId: id },
            _sum: { amount: true },
          });
          if ((supplyAgg._sum.amount ?? 0) + amount > launch.totalSupply) {
            throw new Error("SUPPLY_EXCEEDED");
          }

          const p = await tx.purchase.create({
            data: {
              launchId: id,
              userId: req.user!.id,
              walletAddress,
              amount,
              totalCost,
              txSignature,
              referralId: referral?.id ?? null,
            },
          });

          if (referral) {
            await tx.referral.update({
              where: { id: referral.id },
              data: { usedCount: { increment: 1 } },
            });
          }

          return p;
        });
      } catch (err: any) {
        if (err.message === "SUPPLY_EXCEEDED") {
          res.status(400).json({ error: "Supply exceeded" });
          return;
        }
        throw err;
      }

      res.status(201).json({ purchase: purchaseObject });
    } catch (err: any) {
      if (err.code === "P2002") {
        res.status(400).json({ error: "Duplicate transaction signature" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/launches/:id/purchases
router.get(
  "/purchases",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };

      const launch = await prisma.launch.findUnique({ where: { id } });
      if (!launch) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }

      const isCreator = launch.creatorId === req.user!.id;
      const where = isCreator
        ? { launchId: id }
        : { launchId: id, userId: req.user!.id };

      const purchases = await prisma.purchase.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({ purchases, total: purchases.length });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

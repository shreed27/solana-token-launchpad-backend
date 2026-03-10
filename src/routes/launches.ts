import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware";

const router = Router();

export function computeStatus(
  launch: { totalSupply: number; startsAt: Date; endsAt: Date },
  totalPurchased: number
): string {
  const now = new Date();
  if (totalPurchased >= launch.totalSupply) return "SOLD_OUT";
  if (now < new Date(launch.startsAt)) return "UPCOMING";
  if (now > new Date(launch.endsAt)) return "ENDED";
  return "ACTIVE";
}

function withStatus(launch: any) {
  const totalPurchased = (launch.purchases ?? []).reduce(
    (sum: number, p: { amount: number }) => sum + p.amount,
    0
  );
  const { purchases, ...rest } = launch;
  return {
    ...rest,
    totalPurchased,
    status: computeStatus(launch, totalPurchased),
  };
}

// POST /api/launches
router.post(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        name,
        symbol,
        totalSupply,
        pricePerToken,
        startsAt,
        endsAt,
        maxPerWallet,
        description,
        tiers,
        vesting,
      } = req.body;

      if (
        !name ||
        !symbol ||
        totalSupply == null ||
        pricePerToken == null ||
        !startsAt ||
        !endsAt ||
        maxPerWallet == null
      ) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      if (pricePerToken <= 0) {
        res.status(400).json({ error: "pricePerToken must be > 0" });
        return;
      }
      if (totalSupply <= 0) {
        res.status(400).json({ error: "totalSupply must be > 0" });
        return;
      }
      if (maxPerWallet > totalSupply) {
        res.status(400).json({ error: "maxPerWallet must be <= totalSupply" });
        return;
      }

      const start = new Date(startsAt);
      const end = new Date(endsAt);
      if (end <= start) {
        res.status(400).json({ error: "endsAt must be after startsAt" });
        return;
      }

      const launch = await prisma.launch.create({
        data: {
          creatorId: req.user!.id,
          name,
          symbol,
          totalSupply,
          pricePerToken,
          startsAt: start,
          endsAt: end,
          maxPerWallet,
          description: description ?? null,
          tiers: tiers
            ? {
                create: tiers.map((t: any) => ({
                  minAmount: t.minAmount,
                  maxAmount: t.maxAmount,
                  pricePerToken: t.pricePerToken,
                })),
              }
            : undefined,
          vesting: vesting
            ? {
                create: {
                  cliffDays: vesting.cliffDays,
                  vestingDays: vesting.vestingDays,
                  tgePercent: vesting.tgePercent,
                },
              }
            : undefined,
        },
        include: { tiers: true, vesting: true, purchases: { select: { amount: true } } },
      });

      res.status(201).json({ launch: withStatus(launch) });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/launches
// REWRITTEN: REMOVED PAGINATION LOGIC
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const allLaunches = await prisma.launch.findMany({
      include: {
        tiers: true,
        vesting: true,
        purchases: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const mapped = allLaunches.map(withStatus);

    res.status(200).json({ launches: mapped });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/launches/:id
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const launch = await prisma.launch.findUnique({
      where: { id: req.params.id },
      include: {
        tiers: true,
        vesting: true,
        purchases: { select: { amount: true } },
      },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    res.status(200).json({ launch: withStatus(launch) });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/launches/:id
router.put(
  "/:id",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const launch = await prisma.launch.findUnique({
        where: { id: req.params.id },
      });
      if (!launch) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      if (launch.creatorId !== req.user!.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const {
        name,
        symbol,
        totalSupply,
        pricePerToken,
        startsAt,
        endsAt,
        maxPerWallet,
        description,
      } = req.body;

      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (symbol !== undefined) data.symbol = symbol;
      if (description !== undefined) data.description = description;

      if (pricePerToken !== undefined) {
        if (pricePerToken <= 0) {
          res.status(400).json({ error: "pricePerToken must be > 0" });
          return;
        }
        data.pricePerToken = pricePerToken;
      }
      if (totalSupply !== undefined) {
        if (totalSupply <= 0) {
          res.status(400).json({ error: "totalSupply must be > 0" });
          return;
        }
        data.totalSupply = totalSupply;
      }
      if (maxPerWallet !== undefined) {
        const supply = (totalSupply as number) ?? launch.totalSupply;
        if (maxPerWallet > supply) {
          res.status(400).json({ error: "maxPerWallet must be <= totalSupply" });
          return;
        }
        data.maxPerWallet = maxPerWallet;
      }
      if (startsAt !== undefined) data.startsAt = new Date(startsAt);
      if (endsAt !== undefined) data.endsAt = new Date(endsAt);

      const resolvedStart = (data.startsAt as Date) ?? launch.startsAt;
      const resolvedEnd = (data.endsAt as Date) ?? launch.endsAt;
      if (resolvedEnd <= resolvedStart) {
        res.status(400).json({ error: "endsAt must be after startsAt" });
        return;
      }

      const updated = await prisma.launch.update({
        where: { id: req.params.id },
        data,
        include: {
          tiers: true,
          vesting: true,
          purchases: { select: { amount: true } },
        },
      });

      res.status(200).json({ launch: withStatus(updated) });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

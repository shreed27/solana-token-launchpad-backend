import { Router, Request, Response } from "express";
import { prisma } from "../db";

const router = Router({ mergeParams: true });

// GET /api/launches/:id/vesting?walletAddress=ADDR
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { walletAddress } = req.query;

    if (!walletAddress || typeof walletAddress !== "string") {
      res.status(400).json({ error: "walletAddress query parameter is required" });
      return;
    }

    const launch = await prisma.launch.findUnique({
      where: { id },
      include: { vesting: true },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    // Sum all purchases for this wallet on this launch
    const aggregate = await prisma.purchase.aggregate({
      where: { launchId: id, walletAddress },
      _sum: { amount: true },
    });
    const totalPurchased = aggregate._sum.amount ?? 0;

    // No vesting config — all tokens immediately claimable
    if (!launch.vesting) {
      res.status(200).json({
        totalPurchased,
        tgeAmount: totalPurchased,
        cliffEndsAt: null,
        vestedAmount: totalPurchased,
        lockedAmount: 0,
        claimableAmount: totalPurchased,
      });
      return;
    }

    const { cliffDays, vestingDays, tgePercent } = launch.vesting;

    // TGE amount released immediately at token generation event
    const tgeAmount = Math.floor((totalPurchased * tgePercent) / 100);
    const vestingAmount = totalPurchased - tgeAmount;

    // Cliff ends cliffDays after the launch start date
    const cliffEndsAt = new Date(launch.startsAt);
    cliffEndsAt.setDate(cliffEndsAt.getDate() + cliffDays);

    const now = new Date();
    let vestedAmount = tgeAmount;

    if (now >= cliffEndsAt) {
      const msSinceCliff = now.getTime() - cliffEndsAt.getTime();
      const daysSinceCliff = msSinceCliff / (1000 * 60 * 60 * 24);
      const progress = Math.min(daysSinceCliff / vestingDays, 1);
      vestedAmount = tgeAmount + Math.floor(vestingAmount * progress);
    }

    const lockedAmount = totalPurchased - vestedAmount;
    const claimableAmount = vestedAmount;

    res.status(200).json({
      totalPurchased,
      tgeAmount,
      cliffEndsAt,
      vestedAmount,
      lockedAmount,
      claimableAmount,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router, Response } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware";

const router = Router({ mergeParams: true });

async function getVerifiedCreatorLaunch(launchId: string, userId: string) {
  const launch = await prisma.launch.findUnique({ where: { id: launchId } });
  return { launch, isCreator: launch?.creatorId === userId };
}

// POST /api/launches/:id/referrals
router.post(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { code, discountPercent, maxUses } = req.body;

      if (!code || discountPercent == null || maxUses == null) {
        res
          .status(400)
          .json({ error: "code, discountPercent, and maxUses are required" });
        return;
      }

      const { launch, isCreator } = await getVerifiedCreatorLaunch(
        id,
        req.user!.id
      );
      if (!launch) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      if (!isCreator) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      try {
        const referral = await prisma.referral.create({
          data: { launchId: id, code, discountPercent, maxUses, usedCount: 0 },
        });
        res.status(201).json({ referral });
      } catch (err: any) {
        if (err.code === "P2002") {
          res
            .status(409)
            .json({ error: "Referral code already exists for this launch" });
          return;
        }
        throw err;
      }
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/launches/:id/referrals
router.get(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };

      const { launch, isCreator } = await getVerifiedCreatorLaunch(
        id,
        req.user!.id
      );
      if (!launch) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      if (!isCreator) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const referrals = await prisma.referral.findMany({
        where: { launchId: id },
      });
      res.status(200).json({ referrals });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

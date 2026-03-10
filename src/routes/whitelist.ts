import { Router, Response } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware";

const router = Router({ mergeParams: true });

async function getVerifiedCreatorLaunch(launchId: string, userId: string) {
  const launch = await prisma.launch.findUnique({ where: { id: launchId } });
  return { launch, isCreator: launch?.creatorId === userId };
}

// POST /api/launches/:id/whitelist
router.post(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { addresses } = req.body;

      if (!addresses || !Array.isArray(addresses)) {
        res.status(400).json({ error: "addresses must be a non-empty array" });
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

      let added = 0;
      for (const address of addresses) {
        try {
          await prisma.whitelist.create({ data: { launchId: id, address } });
          added++;
        } catch {
          // skip duplicates — unique constraint violation
        }
      }

      const total = await prisma.whitelist.count({ where: { launchId: id } });
      res.status(200).json({ added, total });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/launches/:id/whitelist
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

      const entries = await prisma.whitelist.findMany({
        where: { launchId: id },
      });
      res.status(200).json({
        addresses: entries.map((e) => e.address),
        total: entries.length,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/launches/:id/whitelist/:address
router.delete(
  "/:address",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id, address } = req.params as { id: string; address: string };

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

      const entry = await prisma.whitelist.findUnique({
        where: { launchId_address: { launchId: id, address } },
      });
      if (!entry) {
        res.status(404).json({ error: "Address not found in whitelist" });
        return;
      }

      await prisma.whitelist.delete({
        where: { launchId_address: { launchId: id, address } },
      });

      res.status(200).json({ removed: true });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

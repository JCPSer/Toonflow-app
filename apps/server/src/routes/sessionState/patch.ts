import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { patchSessionState } from "@/utils/sessionState";

const router = Router();

export default router.patch("/", validateFields({
  patch: z.record(z.string(), z.unknown()),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  const { patch } = req.body as { patch: Record<string, unknown> };
  res.json(success({ state: await patchSessionState(patch) }));
});

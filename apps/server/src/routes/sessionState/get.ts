import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { getSessionState } from "@/utils/sessionState";

const router = Router();

export default router.get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  res.json(success({ state: await getSessionState() }));
});

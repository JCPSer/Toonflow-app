import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { cancel } from "@/modules/workspaceShare/tasks";
import { resolveTaskScope } from "./scope";

export default Router().post("/", validateFields({
  id: z.string().min(1).max(100),
  directory: z.string().max(4096).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const scope = await resolveTaskScope(req, req.body.directory || undefined);
  cancel(scope, req.body.id as string);
  res.json(success({ id: req.body.id }));
});

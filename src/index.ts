import { createApp } from "./api";
import { runWebdavBackup } from "./webdav";

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWebdavBackup(env, { force: false }).then((result) => {
      if (!result.ok) console.error("webdav backup", result.error);
    }));
  },
} satisfies ExportedHandler<Env>;

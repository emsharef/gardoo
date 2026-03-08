import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@gardoo/server/src/router";
import { getUserIdFromToken } from "@gardoo/server/src/trpc";
import { db } from "@gardoo/server/src/db/index";
import { ensureUser } from "@gardoo/server/src/lib/ensureUser";

export const runtime = "nodejs";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async ({ req }) => {
      const authHeader = req.headers.get("authorization");
      const userId = await getUserIdFromToken(authHeader);

      if (userId) {
        await ensureUser(db, userId);
      }

      return { userId, db };
    },
  });

export { handler as GET, handler as POST };

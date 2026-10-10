import { startFakeGoTrue } from "./fake-gotrue";
import { RIG } from "./rig";
import { startTestDatabase } from "./test-database";

/**
 * Brings up the identity rig — Postgres with the versioned auth migration and
 * the GoTrue test double — and tears it down when the run ends. The dev server
 * reaches both over fixed local ports configured in `playwright.config.ts`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const database = await startTestDatabase(RIG.databasePort, process.cwd());

  const auth = await startFakeGoTrue({
    port: RIG.authPort,
    onUserCreated: (user) => database.insertAuthUser(user),
    onBlockIdentity: (email) => database.blockIdentity(email),
    onCountProfiles: (email) => database.countProfiles(email),
    onMakePlatformAdmin: (email) => database.makePlatformAdmin(email),
    onSeedWorkspace: (params) => database.seedWorkspace(params),
    onSeedInvitation: (params) => database.seedInvitation(params),
    onSeedPartner: (params) => database.seedPartner(params),
  });

  return async () => {
    await auth.close();
    await database.close();
  };
}

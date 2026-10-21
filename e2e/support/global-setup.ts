import { startFakeChatwoot } from "./fake-chatwoot";
import { startFakeGoTrue } from "./fake-gotrue";
import { startFakeResend } from "./fake-resend";
import { startFakeTranslate } from "./fake-translate";
import { RIG } from "./rig";
import { startTestDatabase } from "./test-database";

/**
 * Brings up the identity rig — Postgres with the versioned auth migration,
 * the GoTrue test double and the Chatwoot double (A5a) — and tears it down when the run ends. The dev server
 * reaches both over fixed local ports configured in `playwright.config.ts`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const database = await startTestDatabase(RIG.databasePort, process.cwd());

  const auth = await startFakeGoTrue({
    port: RIG.authPort,
    onUserCreated: (user) => database.insertAuthUser(user),
    onBlockIdentity: (email) => database.blockIdentity(email),
    onCountProfiles: (email) => database.countProfiles(email),
    onMakePlatformAdmin: (email, role) =>
      database.makePlatformAdmin(email, role),
    onSeedWorkspace: (params) => database.seedWorkspace(params),
    onSeedInvitation: (params) => database.seedInvitation(params),
    onSeedPartner: (params) => database.seedPartner(params),
    onSeedGuid: (params) => database.seedGuid(params),
    onRunJobs: () => database.runJobs(),
    onSeedNotification: (params) => database.seedNotification(params),
    onMaintenanceOff: () => database.maintenanceOff(),
    onSeedEvent: (params) => database.seedEvent(params),
    onSeedCrmContact: (params) => database.seedCrmContact(params),
    onSeedGuidsAnswer: (params) => database.seedGuidsAnswer(params),
    onSeedProposal: (params) => database.seedProposal(params),
  });
  const chatwoot = await startFakeChatwoot(RIG.chatwootPort);
  const resend = await startFakeResend(RIG.resendPort);
  const translate = await startFakeTranslate(RIG.translatePort);

  return async () => {
    await translate.close();
    await resend.close();
    await chatwoot.close();
    await auth.close();
    await database.close();
  };
}

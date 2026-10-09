import { describe, expect, it } from "vitest";
import { assertDevDatabase } from "../../scripts/lib/dev-database";

describe("assertDevDatabase (ADR 0008, ADR 0010)", () => {
  it("lança erro descritivo quando MIGRATION_DATABASE_URL está ausente ou vazia", () => {
    expect(() => assertDevDatabase(undefined)).toThrowError(
      /MIGRATION_DATABASE_URL está ausente/,
    );
    expect(() => assertDevDatabase("")).toThrowError(
      /MIGRATION_DATABASE_URL está ausente/,
    );
    expect(() => assertDevDatabase("   ")).toThrowError(
      /MIGRATION_DATABASE_URL está ausente/,
    );
  });

  it("recusa host proibido (ex: guidu original mmwmhlafzewdyqsgfkzk ou host arbitrário)", () => {
    const forbiddenGuiduUrl =
      "postgresql://app_migrations:secret@db.mmwmhlafzewdyqsgfkzk.supabase.co:5432/postgres";
    expect(() => assertDevDatabase(forbiddenGuiduUrl)).toThrowError(
      /Conexão recusada para host 'db\.mmwmhlafzewdyqsgfkzk\.supabase\.co'/,
    );

    const forbiddenProdUrl =
      "postgresql://postgres:secret@db.production-domain.com:5432/postgres";
    expect(() => assertDevDatabase(forbiddenProdUrl)).toThrowError(
      /Conexão recusada para host 'db\.production-domain\.com'/,
    );
  });

  it("aceita hosts permitidos: console-guidu (ssulunrysnvwyqjlkpry) e localhost/127.0.0.1", () => {
    // 1. Projeto dev console-guidu direto
    const devDirectUrl =
      "postgresql://app_migrations:secret@db.ssulunrysnvwyqjlkpry.supabase.co:5432/postgres";
    const resultDev = assertDevDatabase(devDirectUrl);
    expect(resultDev.host).toBe("db.ssulunrysnvwyqjlkpry.supabase.co");
    expect(resultDev.user).toBe("app_migrations");
    expect(resultDev.url).toBe(devDirectUrl);

    // 2. Projeto dev console-guidu via pooler com ref no username
    const devPoolerUrl =
      "postgresql://app_migrations.ssulunrysnvwyqjlkpry:secret@aws-1-sa-east-1.pooler.supabase.com:5432/postgres";
    const resultPooler = assertDevDatabase(devPoolerUrl);
    expect(resultPooler.host).toBe("aws-1-sa-east-1.pooler.supabase.com");
    expect(resultPooler.user).toBe("app_migrations");

    // 3. Localhost
    const localhostUrl =
      "postgresql://postgres:postgres@localhost:54322/postgres";
    const resultLocalhost = assertDevDatabase(localhostUrl);
    expect(resultLocalhost.host).toBe("localhost");
    expect(resultLocalhost.user).toBe("postgres");

    // 4. 127.0.0.1
    const ipUrl =
      "postgresql://app_runtime:secret@127.0.0.1:54329/postgres";
    const resultIp = assertDevDatabase(ipUrl);
    expect(resultIp.host).toBe("127.0.0.1");
    expect(resultIp.user).toBe("app_runtime");
  });

  it("rejeita URLs com formato inválido ou protocolo não-postgres", () => {
    expect(() => assertDevDatabase("not-a-valid-url")).toThrowError(
      /Formato de URL de banco de dados inválido/,
    );
    expect(() =>
      assertDevDatabase("http://localhost:5432/postgres"),
    ).toThrowError(/Protocolo de conexão inválido/);
  });
});

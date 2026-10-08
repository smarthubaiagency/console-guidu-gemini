const appName = process.env.APP_NAME ?? "GUIDU";
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6">
      <section>
        <p className="text-muted-foreground text-sm font-medium">
          Fundação em construção
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">
          {appName}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-lg">
          A base segura para uma plataforma SaaS modular.
        </p>
      </section>
    </main>
  );
}

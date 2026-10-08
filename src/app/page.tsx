const appName = process.env.APP_NAME ?? "GUIDU";
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6">
      <section>
        <p className="text-text-secondary text-14 font-medium">
          Fundação em construção
        </p>
        <h1 className="text-48 mt-3 font-semibold tracking-tight">{appName}</h1>
        <p className="text-text-secondary text-18 mt-4 max-w-xl">
          A base segura para uma plataforma SaaS modular.
        </p>
      </section>
    </main>
  );
}

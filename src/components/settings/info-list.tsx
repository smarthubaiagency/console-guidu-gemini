/** Read-only facts of a settings card: label on top, value below. */
export function InfoList({
  items,
}: Readonly<{
  items: ReadonlyArray<{
    label: string;
    value: React.ReactNode;
    mono?: boolean;
    testId?: string;
  }>;
}>) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} data-testid={item.testId}>
          <dt className="text-12 text-text-secondary font-medium">
            {item.label}
          </dt>
          <dd
            className={
              item.mono
                ? "text-12 text-text-subtle mt-1 font-mono break-all"
                : "text-14 text-text mt-1 font-medium"
            }
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

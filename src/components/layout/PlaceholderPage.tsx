export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Em construção — conteúdo real entra nas próximas fases.
      </p>
    </div>
  );
}

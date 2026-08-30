import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function HubspotDetailDialog({
  open,
  onOpenChange,
  title,
  properties,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  properties: Record<string, unknown> | null;
}) {
  const entries = properties ? Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{entries.length} propriedade(s) sincronizada(s) da HubSpot.</p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key} className="border-t border-border first:border-t-0">
                  <td className="w-2/5 px-3 py-2 align-top font-medium text-muted-foreground">{key}</td>
                  <td className="break-words px-3 py-2">{formatValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

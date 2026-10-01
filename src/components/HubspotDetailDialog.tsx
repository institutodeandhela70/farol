import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHubspotPropertyDefs } from "@/lib/hubspotMeta";

export function HubspotDetailDialog({
  open,
  onOpenChange,
  title,
  properties,
  workspaceId,
  objectType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  properties: Record<string, unknown> | null;
  workspaceId: string | undefined;
  objectType: "deals" | "contacts";
}) {
  const { groupedEntries } = useHubspotPropertyDefs(workspaceId, objectType);
  const groups = properties ? groupedEntries(properties) : [];
  const totalFields = groups.reduce((n, g) => n + g.fields.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{totalFields} propriedade(s) sincronizada(s) da HubSpot.</p>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.label} className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">{group.label}</div>
              <table className="w-full text-sm">
                <tbody>
                  {group.fields.map((field) => (
                    <tr key={field.label} className="border-t border-border first:border-t-0">
                      <td className="w-2/5 px-3 py-2 align-top font-medium text-muted-foreground">{field.label}</td>
                      <td className="break-words px-3 py-2">{field.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

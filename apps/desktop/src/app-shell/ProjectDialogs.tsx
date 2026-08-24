import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import type { ProjectCommands } from "../graph/project/useProjectCommands";

export interface ProjectDialogsProps {
  commands: ProjectCommands;
}

/** The project questions that must interrupt normal editing before a destructive action.
 *
 * Both are modal because both decide the fate of work the user cannot get back by any
 * other route, which is exactly the case a transient notification must not be used for.
 */
export function ProjectDialogs({ commands }: ProjectDialogsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Dialog
        open={commands.pendingIntent !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            commands.cancelPendingIntent();
          }
        }}
      >
        <DialogContent
          className="project-decision"
          closeLabel={t("common.actions.close")}
          title={t("project.unsaved.title")}
          description={t("project.unsaved.description")}
        >
          <div className="project-decision__actions">
            <Button variant="primary" onClick={commands.saveThenContinue}>
              {t("project.unsaved.save")}
            </Button>
            <Button
              variant="destructive"
              onClick={commands.discardThenContinue}
            >
              {t("project.unsaved.discard")}
            </Button>
            <Button variant="ghost" onClick={commands.cancelPendingIntent}>
              {t("common.actions.cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={commands.recovery !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            commands.dismissRecovery();
          }
        }}
      >
        <DialogContent
          className="project-decision"
          closeLabel={t("common.actions.close")}
          title={t("project.recovery.title")}
          description={t("project.recovery.description")}
        >
          <div className="project-decision__actions">
            <Button variant="primary" onClick={commands.restoreRecovery}>
              {t("project.recovery.restore")}
            </Button>
            <Button variant="ghost" onClick={commands.dismissRecovery}>
              {t("project.recovery.discard")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

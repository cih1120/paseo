import { i18n } from "@/i18n/i18next";
import { formatDuration } from "@/utils/time";

export function getTurnDurationLabel(durationMs: number): string {
  return i18n.t("message.turnFooter.workedFor", {
    duration: formatDuration(durationMs),
  });
}

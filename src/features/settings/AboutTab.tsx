import { useEffect, useState } from "react";
import { Copy, Download, Heart, Loader2, RefreshCw } from "lucide-react";
import logoUrl from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { Row, Section } from "@/features/data/shared";
import { api, errorMessage } from "@/lib/ipc";
import { useUpdateStore } from "@/features/updates/updateStore";
import { formatLongDate } from "@/lib/dates";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import type { AboutInfo } from "@/types/domain";
import { t } from "@/i18n";

/** Versión, licencia, repositorio y donaciones. */
export function AboutTab() {
  const [info, setInfo] = useState<AboutInfo | null>(null);

  useEffect(() => {
    api.about
      .info()
      .then(setInfo)
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.info(t("Enlace copiado"));
    } catch {
      toast.error(t("No se pudo copiar; selecciona el texto y cópialo a mano"));
    }
  }

  async function donate() {
    try {
      await api.about.openDonation();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-7 text-[13px]">
      <img src={logoUrl} alt="" aria-hidden="true" className="size-14" draggable={false} />
      <Section title="Chronos Private Calendar" description={t("Calendario local, privado y cifrado. Sin cuentas, sin nube y sin telemetría.")}>
        <Row label={t("Versión")}>
          <span className="text-muted">{info?.version ?? "…"}</span>
        </Row>
        <Row label={t("Licencia")}>
          <span className="text-muted">{t("{license} (código abierto)", { license: info?.license ?? "…" })}</span>
        </Row>
        <Row label={t("Código fuente")}>
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate select-all text-muted" title={info?.repository}>
              {info?.repository.replace("https://", "") ?? "…"}
            </span>
            {info && (
              <Button variant="ghost" size="icon" aria-label={t("Copiar enlace del repositorio")} onClick={() => void copy(info.repository)}>
                <Copy />
              </Button>
            )}
          </div>
        </Row>
      </Section>

      <UpdatesSection currentVersion={info?.version} />

      <Section
        title={t("Apoyar el proyecto")}
        description={t("Chronos es gratuito y lo seguirá siendo. Si te resulta útil, puedes apoyar su desarrollo con una donación voluntaria por PayPal.")}
      >
        <div className="space-y-3">
          <Button onClick={() => void donate()} disabled={!info}>
            <Heart />
            {t("Donar con PayPal")}
          </Button>
          <p className="text-[12px] leading-relaxed text-muted">
            {t(
              "Se abrirá {url} en tu navegador. Chronos no envía ningún dato: es tu navegador el que carga la página, y la aplicación sigue sin conectarse a internet. Donar no desbloquea ninguna función.",
              { url: info?.donationUrl.replace("https://", "") ?? "paypal.me" },
            )}
          </p>
        </div>
      </Section>
    </div>
  );
}

/** Buscar e instalar actualizaciones (la única conexión de red, y solo si se pide). */
function UpdatesSection({ currentVersion }: { currentVersion?: string }) {
  const { status, info, error, checkedAt, check, install } = useUpdateStore();
  const autoUpdateCheck = usePrefsStore((s) => s.autoUpdateCheck);
  const setPrefs = usePrefsStore((s) => s.set);
  const busy = status === "checking" || status === "installing";
  const date = info?.date != null ? new Date(info.date) : null;

  return (
    <Section
      title={t("Actualizaciones")}
      description={t(
        "Chronos solo se conecta a internet cuando buscas actualizaciones: consulta el número de la última versión en GitHub y, si la instalas, la descarga de allí. No envía ningún dato tuyo (GitHub ve tu dirección IP, como cualquier web). Cada actualización se comprueba con la firma del autor antes de instalarse.",
      )}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void check()} disabled={busy}>
            {status === "checking" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {status === "checking" ? t("Buscando…") : t("Buscar actualizaciones")}
          </Button>
          <span aria-live="polite" className="text-[12px] text-muted">
            {status === "latest" && t("Tienes la última versión ({version}).", { version: currentVersion ?? "" })}
            {status === "error" && <span className="text-danger">{error}</span>}
            {status === "idle" && checkedAt === null && t("Versión instalada: {version}", { version: currentVersion ?? "…" })}
          </span>
        </div>

        {info && (status === "available" || status === "installing" || (status === "error" && info)) && (
          <div className="space-y-2 rounded-lg border border-border-strong p-3">
            <p className="font-medium text-strong">
              {t("Versión {version} disponible", { version: info.version })}
              {date && !Number.isNaN(date.getTime()) && <span className="font-normal text-muted"> · {formatLongDate(date)}</span>}
            </p>
            {info.notes && (
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{info.notes}</p>
            )}
            {info.canInstall ? (
              <>
                <Button onClick={() => void install()} disabled={busy}>
                  {status === "installing" ? <Loader2 className="animate-spin" /> : <Download />}
                  {status === "installing" ? t("Descargando e instalando…") : t("Descargar e instalar")}
                </Button>
                <p className="text-[12px] leading-relaxed text-muted">
                  {t("Antes de instalar se guarda una copia cifrada de tus datos. Chronos se cerrará y volverá a abrirse con la versión nueva.")}
                </p>
              </>
            ) : (
              <p className="text-[12px] leading-relaxed text-muted">
                {t("Esta instalación no se actualiza sola (por ejemplo, el paquete .deb). Descarga la versión nueva desde la página de Releases del repositorio.")}
              </p>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 text-[12px] leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={autoUpdateCheck}
            onChange={(e) => setPrefs({ autoUpdateCheck: e.target.checked })}
          />
          <span>{t("Buscar actualizaciones automáticamente una vez al día al abrir Chronos (desactivado por defecto).")}</span>
        </label>
      </div>
    </Section>
  );
}

import { useEffect, useState } from "react";
import { Copy, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Row, Section } from "@/features/data/shared";
import { api, errorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { AboutInfo } from "@/types/domain";

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
      toast.info("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar; selecciona el texto y cópialo a mano");
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
      <Section title="Chronos Private Calendar" description="Calendario local, privado y cifrado. Sin cuentas, sin nube y sin telemetría.">
        <Row label="Versión">
          <span className="text-muted">{info?.version ?? "…"}</span>
        </Row>
        <Row label="Licencia">
          <span className="text-muted">{info?.license ?? "…"} (código abierto)</span>
        </Row>
        <Row label="Código fuente">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate select-all text-muted" title={info?.repository}>
              {info?.repository.replace("https://", "") ?? "…"}
            </span>
            {info && (
              <Button variant="ghost" size="icon" aria-label="Copiar enlace del repositorio" onClick={() => void copy(info.repository)}>
                <Copy />
              </Button>
            )}
          </div>
        </Row>
      </Section>

      <Section
        title="Apoyar el proyecto"
        description="Chronos es gratuito y lo seguirá siendo. Si te resulta útil, puedes apoyar su desarrollo con una donación voluntaria por PayPal."
      >
        <div className="space-y-3">
          <Button onClick={() => void donate()} disabled={!info}>
            <Heart />
            Donar con PayPal
          </Button>
          <p className="text-[12px] leading-relaxed text-muted">
            Se abrirá <span className="select-all">{info?.donationUrl.replace("https://", "") ?? "paypal.me"}</span> en tu
            navegador. Chronos no envía ningún dato: es tu navegador el que carga la página, y la aplicación sigue sin
            conectarse a internet. Donar no desbloquea ninguna función.
          </p>
        </div>
      </Section>
    </div>
  );
}

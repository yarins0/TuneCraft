import { useNavigate } from 'react-router-dom';
import AppLogo from '../components/AppLogo';
import PageShell from '../components/PageShell';
import { Badge, AccentCard } from '../components/ui';

export default function Contact() {
  // navigate(-1) sends the user back to wherever they came from.
  // Falls back to "/" if they landed directly on this page with no prior history.
  const navigate = useNavigate();
  const handleBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  return (
    <PageShell>
      <div className="relative z-10 flex-1 max-w-[760px] mx-auto w-full px-6 py-16">

        <AppLogo variant="back" onClick={handleBack} />

        {/* Badge + heading */}
        <div className="inline-flex mb-5 ml-3">
          <Badge>Contact</Badge>
        </div>

        <h1 className="text-5xl font-black tracking-tight leading-none mb-4">
          Get in touch
        </h1>
        <p className="font-mono text-xs text-text-muted mb-8">
          Questions, feedback, or data deletion requests
        </p>

        {/* Contact card */}
        <AccentCard className="p-8">
          <p className="text-text-muted text-sm leading-relaxed mb-6">
            TuneCraft is built and maintained by{' '}
            <span className="text-text-primary font-semibold">Yarin Solomon</span>.
            It is a personal, non-commercial portfolio project.
          </p>

          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs uppercase tracking-widest text-accent opacity-80 w-20 shrink-0">
                GITHUB
              </span>
              <a
                href="https://github.com/yarins0"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-primary hover:text-accent transition-colors duration-200"
              >
                github.com/yarins0
              </a>
            </div>

            <div className="flex items-center gap-4">
              <span className="font-mono text-xs uppercase tracking-widest text-accent opacity-80 w-20 shrink-0">
                PORTFOLIO
              </span>
              <a
                href="https://yarin-lab.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-primary hover:text-accent transition-colors duration-200"
              >
                yarin-lab.vercel.app
              </a>
            </div>

            <div className="flex items-center gap-4">
              <span className="font-mono text-xs uppercase tracking-widest text-accent opacity-80 w-20 shrink-0">
                LINKEDIN
              </span>
              <a
                href="https://www.linkedin.com/in/yarin-solomon/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-primary hover:text-accent transition-colors duration-200"
              >
                linkedin.com/in/yarin-solomon/
              </a>
            </div>

            <div className="flex items-center gap-4">
              <span className="font-mono text-xs uppercase tracking-widest text-accent opacity-80 w-20 shrink-0">
              EMAIL
              </span>
              <a
                href="mailto:yarinso39@gmail.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-primary hover:text-accent transition-colors duration-200"
              >
                yarinso39@gmail.com
              </a>
            </div>

            <div className="flex items-start gap-4">
              <span className="font-mono text-xs uppercase tracking-widest text-accent opacity-80 w-20 shrink-0 pt-0.5">
                Data
              </span>
              <p className="text-sm text-text-muted leading-relaxed">
                To request deletion of your data, open an issue on the GitHub repository
                or reach out via any of the links above.
              </p>
            </div>
          </div>
        </AccentCard>

      </div>
    </PageShell>
  );
}

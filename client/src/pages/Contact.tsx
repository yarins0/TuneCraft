import { useNavigate } from 'react-router-dom';
import AppFooter from '../components/AppFooter';

export default function Contact() {
  // navigate(-1) sends the user back to wherever they came from.
  // Falls back to "/" if they landed directly on this page with no prior history.
  const navigate = useNavigate();
  const handleBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary relative flex flex-col">

      {/* Subtle purple grid texture */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(168,85,247,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top-centre glow blob */}
      <div
        className="fixed pointer-events-none z-0"
        style={{
          top: -200,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 800,
          height: 500,
          background: 'radial-gradient(ellipse, rgba(168,85,247,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Page content */}
      <div className="relative z-10 flex-1 max-w-[760px] mx-auto w-full px-6 py-16">

        {/* Logo — navigates back to wherever the user came from */}
        <button
          onClick={handleBack}
          className="inline-block text-2xl font-black tracking-tight mb-12 transition-all duration-200 hover:scale-105 active:scale-95"
        >
          Tune<span className="text-accent">Craft</span>
        </button>

        {/* Badge + heading */}
        <div className="block mb-5">
          <span className="font-mono text-xs uppercase tracking-widest text-accent bg-accent/10 border border-border-color rounded-full px-3 py-1">
            Contact
          </span>
        </div>

        <h1 className="text-5xl font-black tracking-tight leading-none mb-4">
          Get in touch
        </h1>
        <p className="font-mono text-xs text-text-muted mb-8">
          Questions, feedback, or data deletion requests
        </p>

        {/* Contact card */}
        <div
          className="border border-border-color rounded-2xl p-8"
          style={{
            background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(168,85,247,0.02))',
          }}
        >
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
        </div>

      </div>

      <div className="relative z-10">
        <AppFooter />
      </div>
    </div>
  );
}

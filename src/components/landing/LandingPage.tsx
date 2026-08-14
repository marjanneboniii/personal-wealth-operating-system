import { LandingFooter, LandingHeader } from "@/components/landing/LandingChrome";
import LandingHero from "@/components/landing/LandingHero";
import {
  ConnectedSection,
  ProblemSection,
  SolutionSection,
} from "@/components/landing/LandingStory";
import {
  FeaturesSection,
  HowItWorksSection,
  PersonasSection,
  UnderstandingSection,
} from "@/components/landing/LandingValue";
import {
  FinalCtaSection,
  TrustSection,
  WhySection,
} from "@/components/landing/LandingClosing";

/**
 * «تراز» — Product-grade landing page.
 *
 * The page walks the visitor through a conversion funnel:
 *   Attention (Hero + real product preview)
 *   → Problem (scattered money reality)
 *   → Solution (every flow becomes one picture)
 *   → Architecture (everything is connected)
 *   → Outcomes (features with a user result)
 *   → Understanding (data → financial meaning)
 *   → Personalization (who it is for)
 *   → How it works (register → categorize → analyze → decide)
 *   → Trust (honest, claim-free)
 *   → Story (why Taraz exists)
 *   → Conversion (final CTA)
 *
 * Only capabilities that actually exist in the product are shown.
 */
export default function LandingPage() {
  return (
    <div className="landing">
      <LandingHeader />

      <LandingHero />

      <div>
        <ProblemSection />
        <SolutionSection />
        <ConnectedSection />
        <FeaturesSection />
        <UnderstandingSection />
        <PersonasSection />
        <HowItWorksSection />
        <TrustSection />
        <WhySection />
        <FinalCtaSection />
      </div>

      <LandingFooter />
    </div>
  );
}

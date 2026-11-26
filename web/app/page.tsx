import { site } from "@/lib/site";
import { Hero } from "@/components/Hero";
import { HearSection } from "@/components/HearSection";
import { Findings } from "@/components/Findings";
import { MapSection } from "@/components/MapSection";
import { FaceOff } from "@/components/FaceOff";
import { Recommendations } from "@/components/Recommendations";
import { Footer } from "@/components/Footer";
import { MotionRoot } from "@/components/Motion";
import { SampleBanner } from "@/components/SampleBanner";
import { SiteProvider } from "@/components/SiteContext";

export default function Home() {
  return (
    <SiteProvider value={{ models: site.meta.models, primaryModel: site.meta.primary_model, nClips: site.nClips, isSample: site.isSample }}>
      <MotionRoot>
        <div style={site.isSample ? ({ ["--banner-h" as string]: "38px" } as React.CSSProperties) : undefined}>
          {site.isSample && <SampleBanner />}
          <Hero />
          <main>
            <HearSection />
            <Findings />
            <MapSection />
            <FaceOff />
            <Recommendations />
          </main>
          <Footer />
        </div>
      </MotionRoot>
    </SiteProvider>
  );
}

import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk">
      <div className="pt-3">
        <MarketingNav />
      </div>
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}

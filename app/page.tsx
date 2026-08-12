import type { Metadata } from "next";
import { Contact } from "@/components/landing/contact";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { Journey } from "@/components/landing/journey";
import { Navbar } from "@/components/landing/navbar";
import { Origin } from "@/components/landing/origin";
import { ProductSample } from "@/components/landing/product-sample";
import { Scenarios } from "@/components/landing/scenarios";

export const metadata: Metadata = {
  title: "Fides — plataforma contractual administrada",
  description:
    "Cada Organización emite sus contratos con el contenido ya publicado, los comparte con un enlace y conserva el expediente completo.",
};

export default function LandingPage() {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-carbon focus:px-4 focus:py-2 focus:text-sm focus:text-ivory"
      >
        Ir al contenido
      </a>
      <Navbar />
      <main id="contenido">
        <Hero />
        <Scenarios />
        <Journey />
        <ProductSample />
        <Origin />
        <Contact />
      </main>
      <Footer />
    </>
  );
}

/**
 * Configuración mínima y consistente con los tokens de `app/globals.css`.
 * Los valores viven en variables CSS; aquí sólo se les da nombre de utilidad.
 * @type {import("tailwindcss").Config}
 */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        carbon: "var(--color-carbon)",
        "carbon-soft": "var(--color-carbon-soft)",
        "carbon-deep": "var(--color-carbon-deep)",
        accent: "var(--color-accent)",
        "accent-strong": "var(--color-accent-strong)",
        "accent-soft": "var(--color-accent-soft)",
        ivory: "var(--color-ivory)",
        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        line: "var(--color-line)",
        "line-dark": "var(--color-line-dark)",
        info: "var(--color-info)",
        "info-soft": "var(--color-info-soft)",
        success: "var(--color-success)",
        "success-soft": "var(--color-success-soft)",
        warn: "var(--color-warn)",
        "warn-soft": "var(--color-warn-soft)",
        danger: "var(--color-danger)",
        "danger-soft": "var(--color-danger-soft)",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      maxWidth: {
        editorial: "72rem",
      },
    },
  },
  plugins: [],
};

export default config;

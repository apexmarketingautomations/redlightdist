export type ThemePreset = "luxury" | "dark" | "minimal" | "glam" | "lifestyle";
export interface ThemeTokens {
  fontHeading: string;
  fontBody: string;
  radius: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
  buttonText: string;
  navStyle: "glass" | "solid" | "minimal";
  cardStyle: "soft" | "bordered" | "elevated";
  gridGap: string;
}

export const themePresets: Readonly<Record<ThemePreset, ThemeTokens>> = {
  luxury: {
    fontHeading:"Georgia, serif", fontBody:"Inter, ui-sans-serif, system-ui", radius:"18px",
    background:"#0d0c0a",surface:"#171510",text:"#f7f1e3",muted:"#b8ad95",primary:"#d5b56d",secondary:"#6f5b31",accent:"#f4dfad",buttonText:"#11100d",navStyle:"glass",cardStyle:"elevated",gridGap:"16px"
  },
  dark: {
    fontHeading:"Inter, ui-sans-serif, system-ui",fontBody:"Inter, ui-sans-serif, system-ui",radius:"14px",
    background:"#090b10",surface:"#121620",text:"#f7f9fc",muted:"#9aa5b4",primary:"#7c5cff",secondary:"#20273a",accent:"#24d3ee",buttonText:"#ffffff",navStyle:"glass",cardStyle:"bordered",gridGap:"12px"
  },
  minimal: {
    fontHeading:"Arial, sans-serif",fontBody:"Arial, sans-serif",radius:"10px",
    background:"#ffffff",surface:"#f7f7f5",text:"#141414",muted:"#6d6d69",primary:"#151515",secondary:"#ededeb",accent:"#777770",buttonText:"#ffffff",navStyle:"minimal",cardStyle:"bordered",gridGap:"18px"
  },
  glam: {
    fontHeading:"Georgia, serif",fontBody:"Inter, ui-sans-serif, system-ui",radius:"24px",
    background:"#fff5fa",surface:"#ffffff",text:"#351321",muted:"#8a5c70",primary:"#e82b87",secondary:"#f9c2dc",accent:"#ff7dbc",buttonText:"#ffffff",navStyle:"glass",cardStyle:"soft",gridGap:"14px"
  },
  lifestyle: {
    fontHeading:"Trebuchet MS, sans-serif",fontBody:"Inter, ui-sans-serif, system-ui",radius:"20px",
    background:"#f6f4ee",surface:"#fffdf8",text:"#233026",muted:"#6d786f",primary:"#4f735b",secondary:"#d9e1d3",accent:"#c57b57",buttonText:"#ffffff",navStyle:"solid",cardStyle:"soft",gridGap:"16px"
  }
};

export function resolveTheme(preset: ThemePreset, overrides: Partial<ThemeTokens> = {}): ThemeTokens {
  return {...themePresets[preset],...overrides};
}
export function themeCssVariables(tokens: ThemeTokens): Record<string,string> {
  return {
    "--creator-bg":tokens.background,"--creator-surface":tokens.surface,"--creator-text":tokens.text,"--creator-muted":tokens.muted,
    "--creator-primary":tokens.primary,"--creator-secondary":tokens.secondary,"--creator-accent":tokens.accent,"--creator-button-text":tokens.buttonText,
    "--creator-radius":tokens.radius,"--creator-grid-gap":tokens.gridGap,"--creator-font-heading":tokens.fontHeading,"--creator-font-body":tokens.fontBody,
  };
}

import { fa } from "./fa";
import { en } from "./en";

export function getTranslations(lang: "fa" | "en" = "fa") {
  return lang === "en" ? en : fa;
}

export { fa, en };

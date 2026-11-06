import type { PartNames } from "./parts";

/** Names of the default zones in the four languages (the server writes them on the order PDF in the language of the body shop). Zones added by the admin carry their own names. */
export const ZONE_NAMES: Record<string, PartNames> = {
  haube: { de: "Motorhaube", en: "Bonnet", fr: "Capot", es: "Capó" },
  dach: { de: "Dach", en: "Roof", fr: "Toit", es: "Techo" },
  dachholm_l: { de: "Dachholm links", en: "Roof rail left", fr: "Longeron de toit gauche", es: "Larguero de techo izq." },
  dachholm_r: { de: "Dachholm rechts", en: "Roof rail right", fr: "Longeron de toit droit", es: "Larguero de techo der." },
  heck: { de: "Heckklappe", en: "Tailgate", fr: "Hayon", es: "Portón trasero" },
  heck_u: { de: "Heckklappe unten", en: "Tailgate lower", fr: "Hayon bas", es: "Portón trasero inf." },
  kfl_vl: { de: "Kotflügel vorn links", en: "Front wing left", fr: "Aile avant gauche", es: "Aleta del. izq." },
  tuer_vl: { de: "Tür vorn links", en: "Front door left", fr: "Porte avant gauche", es: "Puerta del. izq." },
  tuer_hl: { de: "Tür hinten links", en: "Rear door left", fr: "Porte arrière gauche", es: "Puerta tras. izq." },
  sw_hl: { de: "Seitenwand hinten links", en: "Rear quarter left", fr: "Panneau latéral arrière gauche", es: "Panel lateral izq." },
  kfl_vr: { de: "Kotflügel vorn rechts", en: "Front wing right", fr: "Aile avant droite", es: "Aleta del. der." },
  tuer_vr: { de: "Tür vorn rechts", en: "Front door right", fr: "Porte avant droite", es: "Puerta del. der." },
  tuer_hr: { de: "Tür hinten rechts", en: "Rear door right", fr: "Porte arrière droite", es: "Puerta tras. der." },
  sw_hr: { de: "Seitenwand hinten rechts", en: "Rear quarter right", fr: "Panneau latéral arrière droit", es: "Panel lateral der." },
  ws: { de: "Windschutzscheibe", en: "Windscreen", fr: "Pare-brise", es: "Parabrisas" },
  rs: { de: "Heckscheibe", en: "Rear window", fr: "Lunette arrière", es: "Luna trasera" },
  int_himmel: { de: "Dachhimmel", en: "Headliner", fr: "Ciel de toit", es: "Techo interior" },
  int_verkleidung: { de: "Innenverkleidung", en: "Interior trim", fr: "Garnitures intérieures", es: "Revestimientos interiores" },
  int_saeulen: { de: "Säulenverkleidung", en: "Pillar trims", fr: "Garnitures de montants", es: "Revestimientos de pilares" },
  int_sonstige: { de: "Innenraum, sonstiges", en: "Interior, other", fr: "Habitacle, autres", es: "Habitáculo, otros" },
};

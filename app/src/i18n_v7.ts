/** v4 strings: search picker, administration on a phone. German, English, French and Spanish (same keys). */
export const deV7 = {
  pkRemove: "Entfernen", pkUse: "„{q}“ verwenden", pkNoMatch: "Kein Treffer für „{q}“",
  pkWorksHere: "arbeitet hier", pkWorksWith: "arbeitet mit {name}", pkFull: "voll", pkOtherTenant: "anderer Tenant", pkPlaces: "{n}/{cap} Plätze",
  pkTechPh: "Techniker suchen oder Namen eingeben", pkTechHint: "{n} Techniker · Namen eingeben (freier Name möglich)",
  pkPeoplePh: "Person oder Station suchen", pkPeopleHint: "{n} Personen · Namen oder Station eingeben",
  pkInsurerPh: "Versicherung suchen", pkInsurerHint: "{n} Versicherungen · Namen eingeben",
  pkStationPh: "Station suchen (Name, Adresse, Typ)", pkStationHint: "{n} Stationen · Namen, Adresse oder Typ eingeben",
  pkKeepPh: "Name (leer = unverändert)", pkSamePh: "Name (leer = wie PDR-Techniker)", pkPdrTag: "PDR", pkHeadlinerTag: "Headliner",
  v7AdminSection: "Bereich",
} as const;

export const enV7: Record<keyof typeof deV7, string> = {
  pkRemove: "Remove", pkUse: "Use “{q}”", pkNoMatch: "No match for “{q}”",
  pkWorksHere: "works here", pkWorksWith: "works with {name}", pkFull: "full", pkOtherTenant: "other tenant", pkPlaces: "{n}/{cap} places",
  pkTechPh: "Search a technician or type a name", pkTechHint: "{n} technicians · type a name (any name allowed)",
  pkPeoplePh: "Search a person or a station", pkPeopleHint: "{n} people · type a name or a station",
  pkInsurerPh: "Search an insurer", pkInsurerHint: "{n} insurers · type a name",
  pkStationPh: "Search a station (name, address, type)", pkStationHint: "{n} stations · type a name, an address or a type",
  pkKeepPh: "Name (empty = keep)", pkSamePh: "Name (empty = same as PDR technician)", pkPdrTag: "PDR", pkHeadlinerTag: "Headliner",
  v7AdminSection: "Section",
};

export const frV7: Record<string, string> = {
  pkRemove: "Retirer", pkUse: "Utiliser « {q} »", pkNoMatch: "Aucun résultat pour « {q} »",
  pkWorksHere: "travaille ici", pkWorksWith: "travaille avec {name}", pkFull: "complète", pkOtherTenant: "autre tenant", pkPlaces: "{n}/{cap} places",
  pkTechPh: "Rechercher un technicien ou saisir un nom", pkTechHint: "{n} techniciens · saisissez un nom (nom libre possible)",
  pkPeoplePh: "Rechercher une personne ou une station", pkPeopleHint: "{n} personnes · saisissez un nom ou une station",
  pkInsurerPh: "Rechercher un assureur", pkInsurerHint: "{n} assureurs · saisissez un nom",
  pkStationPh: "Rechercher une station (nom, adresse, type)", pkStationHint: "{n} stations · saisissez un nom, une adresse ou un type",
  pkKeepPh: "Nom (vide = inchangé)", pkSamePh: "Nom (vide = comme le technicien PDR)", pkPdrTag: "PDR", pkHeadlinerTag: "Headliner",
  v7AdminSection: "Section",
};

export const esV7: Record<string, string> = {
  pkRemove: "Quitar", pkUse: "Usar «{q}»", pkNoMatch: "Sin resultados para «{q}»",
  pkWorksHere: "trabaja aquí", pkWorksWith: "trabaja con {name}", pkFull: "llena", pkOtherTenant: "otro tenant", pkPlaces: "{n}/{cap} plazas",
  pkTechPh: "Buscar un técnico o escribir un nombre", pkTechHint: "{n} técnicos · escriba un nombre (nombre libre posible)",
  pkPeoplePh: "Buscar una persona o una estación", pkPeopleHint: "{n} personas · escriba un nombre o una estación",
  pkInsurerPh: "Buscar una aseguradora", pkInsurerHint: "{n} aseguradoras · escriba un nombre",
  pkStationPh: "Buscar una estación (nombre, dirección, tipo)", pkStationHint: "{n} estaciones · escriba un nombre, una dirección o un tipo",
  pkKeepPh: "Nombre (vacío = sin cambios)", pkSamePh: "Nombre (vacío = igual que el técnico PDR)", pkPdrTag: "PDR", pkHeadlinerTag: "Headliner",
  v7AdminSection: "Sección",
};

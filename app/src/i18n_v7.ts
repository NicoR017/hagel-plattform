/** v4 strings: search picker, administration on a phone. German, English, French and Spanish (same keys). */
export const deV7 = {
  pkRemove: "Entfernen", pkUse: "„{q}“ verwenden", pkNoMatch: "Kein Treffer für „{q}“",
  pkWorksHere: "arbeitet hier", pkWorksWith: "arbeitet mit {name}", pkFull: "voll", pkOtherTenant: "anderer Tenant", pkPlaces: "{n}/{cap} Plätze",
  pkTechPh: "Techniker suchen oder Namen eingeben", pkTechHint: "{n} Techniker · Namen eingeben (freier Name möglich)",
  pkPeoplePh: "Person oder Station suchen", pkPeopleHint: "{n} Personen · Namen oder Station eingeben",
  pkInsurerPh: "Versicherung suchen", pkInsurerHint: "{n} Versicherungen · Namen eingeben",
  pkStationPh: "Station suchen (Name, Adresse, Typ)", pkStationHint: "{n} Stationen · Namen, Adresse oder Typ eingeben",
  pkKeepPh: "Name (leer = unverändert)", pkSamePh: "Name (leer = wie PDR-Techniker)", pkPdrTag: "PDR", pkHeadlinerTag: "Headliner",
  srPlaceholder: "Fahrzeug suchen – Kennzeichen, FIN, Schaden … (alle Stationen)", srShowAll: "Alle Ergebnisse zeigen ({n}) ›", srTitle: "Suchergebnisse", srNone: "Kein Fahrzeug gefunden für „{q}“.", srAllStatus: "Alle Status", srAllStations: "Alle Stationen", srNet: "Netto", srType: "Suche", srSearchBtn: "Suchen",
  nsTitle: "Neue Scans", nsSearchPh: "Kennzeichen, Carrosserie, Versicherung, Colibri-Nr., Marke, Modell", nsAllStations: "Alle", nsNoStation: "Keiner Station zugeordnet", nsStart: "Gutachten starten ›", nsPickStation: "In welcher Station soll das Fahrzeug angelegt werden?", nsPickPh: "Station suchen", nsGo: "Gutachten starten", nsNoCustomer: "Carrosserie unbekannt: sie kann später in den Grunddaten gewählt werden.", nsOnlineOnly: "Die neuen Scans sind nur online verfügbar.", nsEmpty: "Keine neuen Scans.", nsStationCol: "Station", nsCount: "{n} Scans", nsFailed: "Der Scan konnte nicht übernommen werden",
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
  srPlaceholder: "Search vehicle – plate, VIN, claim … (all stations)", srShowAll: "Show all results ({n}) ›", srTitle: "Search results", srNone: "No vehicle found for “{q}”.", srAllStatus: "All statuses", srAllStations: "All stations", srNet: "Net", srType: "Search", srSearchBtn: "Search",
  nsTitle: "New scans", nsSearchPh: "Plate, body shop, insurer, Colibri no., make, model", nsAllStations: "All", nsNoStation: "Not assigned to a station", nsStart: "Start assessment ›", nsPickStation: "In which station should the vehicle be created?", nsPickPh: "Search a station", nsGo: "Start assessment", nsNoCustomer: "Body shop unknown: it can be chosen later in Basics.", nsOnlineOnly: "New scans are only available online.", nsEmpty: "No new scans.", nsStationCol: "Station", nsCount: "{n} scans", nsFailed: "The scan could not be taken over",
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
  srPlaceholder: "Rechercher un véhicule – plaque, VIN, sinistre … (toutes les stations)", srShowAll: "Voir tous les résultats ({n}) ›", srTitle: "Résultats de la recherche", srNone: "Aucun véhicule trouvé pour « {q} ».", srAllStatus: "Tous les statuts", srAllStations: "Toutes les stations", srNet: "Net", srType: "Recherche", srSearchBtn: "Rechercher",
  nsTitle: "Nouveaux scans", nsSearchPh: "Plaque, carrosserie, assureur, n° Colibri, marque, modèle", nsAllStations: "Toutes", nsNoStation: "Sans station", nsStart: "Démarrer l'expertise ›", nsPickStation: "Dans quelle station créer le véhicule ?", nsPickPh: "Rechercher une station", nsGo: "Démarrer l'expertise", nsNoCustomer: "Carrosserie inconnue : elle pourra être choisie plus tard dans Généralités.", nsOnlineOnly: "Les nouveaux scans ne sont disponibles qu'en ligne.", nsEmpty: "Aucun nouveau scan.", nsStationCol: "Station", nsCount: "{n} scans", nsFailed: "Le scan n'a pas pu être repris",
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
  srPlaceholder: "Buscar vehículo – matrícula, VIN, siniestro … (todas las estaciones)", srShowAll: "Ver todos los resultados ({n}) ›", srTitle: "Resultados de la búsqueda", srNone: "Ningún vehículo encontrado para «{q}».", srAllStatus: "Todos los estados", srAllStations: "Todas las estaciones", srNet: "Neto", srType: "Búsqueda", srSearchBtn: "Buscar",
  nsTitle: "Nuevos escaneos", nsSearchPh: "Matrícula, taller, aseguradora, n.º Colibri, marca, modelo", nsAllStations: "Todas", nsNoStation: "Sin estación", nsStart: "Iniciar peritaje ›", nsPickStation: "¿En qué estación se crea el vehículo?", nsPickPh: "Buscar una estación", nsGo: "Iniciar peritaje", nsNoCustomer: "Taller desconocido: se puede elegir más tarde en Datos generales.", nsOnlineOnly: "Los nuevos escaneos solo están disponibles en línea.", nsEmpty: "No hay nuevos escaneos.", nsStationCol: "Estación", nsCount: "{n} escaneos", nsFailed: "No se pudo importar el escaneo",
  v7AdminSection: "Sección",
};

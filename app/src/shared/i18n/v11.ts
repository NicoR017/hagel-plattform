/** V11 strings (Repair v2): consent to move the car, "do not move" flag and the driver of a move. German, English, French and Spanish (same keys). */
export const deV11 = {
  f1ConsentTitle: "Verlegung des Fahrzeugs",
  f1ConsentHint: "Nicht angekreuzt = das Fahrzeug darf nicht verlegt werden (🚫). Der Parkplatz neben der Station bleibt möglich. Der Text steht in der Sprache des Kunden.",
  f1NoMove: "Nicht verlegen", f1NoMoveTip: "Der Kunde hat einer Verlegung nicht zugestimmt",
  f1ConsentYes: "Verlegung erlaubt", f1ConsentNo: "Verlegung nicht erlaubt",
  f1Driver: "Fahrer", f1DriverPh: "Fahrer wählen …", f1DriverHint: "Nur Personen der Abgangsstation ({n})",
  f1DriverNone: "Der Abgangsstation ist niemand zugeordnet: Fahrer können nicht gewählt werden.", f1DriverReq: "Bitte einen Fahrer wählen.",
  f1MoveBlocked: "Dieses Fahrzeug darf nicht verlegt werden (der Kunde hat nicht zugestimmt). Möglich ist nur der Parkplatz neben der Station.",
};
export const enV11: Record<keyof typeof deV11, string> = {
  f1ConsentTitle: "Moving the car",
  f1ConsentHint: "Not ticked = the car must not be moved (🚫). The parking next to the station stays possible. The text is shown in the customer's language.",
  f1NoMove: "Do not move", f1NoMoveTip: "The customer did not allow the car to be moved",
  f1ConsentYes: "Move allowed", f1ConsentNo: "Move not allowed",
  f1Driver: "Driver", f1DriverPh: "Choose the driver …", f1DriverHint: "Only people of the departure station ({n})",
  f1DriverNone: "Nobody is assigned to the departure station: no driver can be chosen.", f1DriverReq: "Please choose a driver.",
  f1MoveBlocked: "This car must not be moved (the customer did not agree). Only the parking next to the station is possible.",
};
export const frV11: Record<keyof typeof deV11, string> = {
  f1ConsentTitle: "Déplacement du véhicule",
  f1ConsentHint: "Case non cochée = le véhicule ne doit pas être déplacé (🚫). Le parking à côté de la station reste possible. Le texte est affiché dans la langue du client.",
  f1NoMove: "Ne pas déplacer", f1NoMoveTip: "Le client n'a pas autorisé le déplacement du véhicule",
  f1ConsentYes: "Déplacement autorisé", f1ConsentNo: "Déplacement non autorisé",
  f1Driver: "Conducteur", f1DriverPh: "Choisir le conducteur …", f1DriverHint: "Uniquement les personnes de la station de départ ({n})",
  f1DriverNone: "Personne n'est affecté à la station de départ : aucun conducteur ne peut être choisi.", f1DriverReq: "Choisis un conducteur.",
  f1MoveBlocked: "Ce véhicule ne doit pas être déplacé (le client n'a pas donné son accord). Seul le parking à côté de la station est possible.",
};
export const esV11: Record<keyof typeof deV11, string> = {
  f1ConsentTitle: "Traslado del vehículo",
  f1ConsentHint: "Sin marcar = el vehículo no debe trasladarse (🚫). El aparcamiento junto a la estación sigue siendo posible. El texto se muestra en el idioma del cliente.",
  f1NoMove: "No trasladar", f1NoMoveTip: "El cliente no ha autorizado el traslado del vehículo",
  f1ConsentYes: "Traslado autorizado", f1ConsentNo: "Traslado no autorizado",
  f1Driver: "Conductor", f1DriverPh: "Elegir conductor …", f1DriverHint: "Solo personas de la estación de salida ({n})",
  f1DriverNone: "Nadie está asignado a la estación de salida: no se puede elegir conductor.", f1DriverReq: "Elige un conductor.",
  f1MoveBlocked: "Este vehículo no debe trasladarse (el cliente no lo ha autorizado). Solo es posible el aparcamiento junto a la estación.",
};

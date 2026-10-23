/** PDR Citas (appointments of the day, start an expertise from one): German, English, French, Spanish, same keys. */
export const deCitas = {
  ciBlockTitle: "Termine des Tages (PDR Citas)", ciToday: "Heute", ciPrevDay: "Vortag", ciNextDay: "Folgetag", ciRefresh: "Aktualisieren", ciOnlineOnly: "Nur online verfügbar",
  ciNone: "Keine Termine an diesem Tag.", ciUnreachable: "PDR Citas ist gerade nicht erreichbar. Alles andere funktioniert weiter.",
  ciUpcoming: "Bevorstehend", ciCancelReq: "Stornierung angefragt", ciStarted: "Expertise gestartet", ciScanFound: "Scan gefunden",
  ciAdminTitle: "PDR Citas (Terminbuchung)", ciLocation: "PDR-Citas-Standort", ciNoLocation: "— keiner —",
  ciLocationHint: "Die Termine dieses Standorts erscheinen auf der Seite der Station.",
  ciNotConfigured: "Nicht eingerichtet (CITAS_API_URL und CITAS_API_KEY fehlen).", ciConnected: "Verbunden: {n} Standorte", ciFailed: "Verbindung fehlgeschlagen", ciTest: "Verbindung testen",
  ciErr_unauthorized: "Der Schlüssel wird abgelehnt.", ciErr_disabled: "Die Schnittstelle ist bei Citas ausgeschaltet.", ciErr_unreachable: "Citas antwortet nicht.",
  ciStartTitle: "Expertise aus Termin starten", ciCrumb: "Termin", ciAppointment: "Termin", ciCustomer: "Kunde", ciInsurance: "Versicherung", ciCase: "Schadennummer", ciVehicle: "Fahrzeug",
  ciScansOfDay: "Scans dieses Tages", ciNoScansDay: "Kein Scan dieser Station an diesem Tag. Ohne Scan starten oder alle Scans zeigen.",
  ciAllScans: "Alle Scans zeigen (andere Stationen und Tage)", ciMatch: "Passendes Kennzeichen",
  ciStartWith: "Mit diesem Scan starten", ciStartWithout: "Ohne Scan starten", ciStarting: "Startet …",
  ciPlateMismatch: "Das Kennzeichen des Scans ({scan}) weicht vom Termin ({appt}) ab. Trotzdem starten?",
  ciAlready: "Für diesen Termin wurde schon eine Expertise gestartet.", ciOpen: "Expertise öffnen", ciNotFound: "Termin nicht gefunden.",
} as const;

export const enCitas: Record<keyof typeof deCitas, string> = {
  ciBlockTitle: "Appointments of the day (PDR Citas)", ciToday: "Today", ciPrevDay: "Previous day", ciNextDay: "Next day", ciRefresh: "Refresh", ciOnlineOnly: "Available online only",
  ciNone: "No appointments on this day.", ciUnreachable: "PDR Citas cannot be reached right now. Everything else keeps working.",
  ciUpcoming: "Upcoming", ciCancelReq: "Cancellation requested", ciStarted: "Expertise started", ciScanFound: "Scan found",
  ciAdminTitle: "PDR Citas (booking)", ciLocation: "PDR Citas location", ciNoLocation: "— none —",
  ciLocationHint: "The appointments of this location appear on the station's page.",
  ciNotConfigured: "Not set up (CITAS_API_URL and CITAS_API_KEY are missing).", ciConnected: "Connected: {n} locations", ciFailed: "Connection failed", ciTest: "Test connection",
  ciErr_unauthorized: "The key is rejected.", ciErr_disabled: "The interface is switched off at Citas.", ciErr_unreachable: "Citas does not answer.",
  ciStartTitle: "Start an expertise from an appointment", ciCrumb: "Appointment", ciAppointment: "Appointment", ciCustomer: "Customer", ciInsurance: "Insurance", ciCase: "Claim number", ciVehicle: "Vehicle",
  ciScansOfDay: "Scans of this day", ciNoScansDay: "No scan of this station on that day. Start without a scan or show all scans.",
  ciAllScans: "Show all scans (other stations and days)", ciMatch: "Matching plate",
  ciStartWith: "Start with this scan", ciStartWithout: "Start without a scan", ciStarting: "Starting …",
  ciPlateMismatch: "The plate of the scan ({scan}) differs from the appointment ({appt}). Start anyway?",
  ciAlready: "An expertise was already started for this appointment.", ciOpen: "Open expertise", ciNotFound: "Appointment not found.",
};

export const frCitas: Record<keyof typeof deCitas, string> = {
  ciBlockTitle: "RDV du jour (PDR Citas)", ciToday: "Aujourd'hui", ciPrevDay: "Veille", ciNextDay: "Lendemain", ciRefresh: "Actualiser", ciOnlineOnly: "Disponible en ligne uniquement",
  ciNone: "Aucun rendez-vous ce jour-là.", ciUnreachable: "PDR Citas est injoignable pour le moment. Le reste fonctionne normalement.",
  ciUpcoming: "À venir", ciCancelReq: "Annulation demandée", ciStarted: "Expertise démarrée", ciScanFound: "Scan trouvé",
  ciAdminTitle: "PDR Citas (prise de rendez-vous)", ciLocation: "Lieu PDR Citas", ciNoLocation: "— aucun —",
  ciLocationHint: "Les rendez-vous de ce lieu apparaissent sur la page de la station.",
  ciNotConfigured: "Non configuré (CITAS_API_URL et CITAS_API_KEY manquantes).", ciConnected: "Connecté : {n} lieux", ciFailed: "Échec de la connexion", ciTest: "Tester la connexion",
  ciErr_unauthorized: "La clé est refusée.", ciErr_disabled: "L'interface est désactivée côté Citas.", ciErr_unreachable: "Citas ne répond pas.",
  ciStartTitle: "Démarrer l'expertise depuis un RDV", ciCrumb: "Rendez-vous", ciAppointment: "Rendez-vous", ciCustomer: "Client", ciInsurance: "Assurance", ciCase: "N° de sinistre", ciVehicle: "Véhicule",
  ciScansOfDay: "Scans de ce jour", ciNoScansDay: "Aucun scan de cette station ce jour-là. Démarrez sans scan ou affichez tous les scans.",
  ciAllScans: "Afficher tous les scans (autres stations et jours)", ciMatch: "Plaque correspondante",
  ciStartWith: "Démarrer avec ce scan", ciStartWithout: "Démarrer sans scan", ciStarting: "Démarrage …",
  ciPlateMismatch: "La plaque du scan ({scan}) diffère de celle du RDV ({appt}). Démarrer quand même ?",
  ciAlready: "Une expertise a déjà été démarrée pour ce RDV.", ciOpen: "Ouvrir l'expertise", ciNotFound: "Rendez-vous introuvable.",
};

export const esCitas: Record<keyof typeof deCitas, string> = {
  ciBlockTitle: "Citas del día (PDR Citas)", ciToday: "Hoy", ciPrevDay: "Día anterior", ciNextDay: "Día siguiente", ciRefresh: "Actualizar", ciOnlineOnly: "Disponible solo en línea",
  ciNone: "No hay citas ese día.", ciUnreachable: "No se puede contactar con PDR Citas ahora. Todo lo demás sigue funcionando.",
  ciUpcoming: "Próxima", ciCancelReq: "Cancelación solicitada", ciStarted: "Peritación iniciada", ciScanFound: "Escaneo encontrado",
  ciAdminTitle: "PDR Citas (reserva de citas)", ciLocation: "Sede PDR Citas", ciNoLocation: "— ninguna —",
  ciLocationHint: "Las citas de esta sede aparecen en la página de la estación.",
  ciNotConfigured: "No configurado (faltan CITAS_API_URL y CITAS_API_KEY).", ciConnected: "Conectado: {n} sedes", ciFailed: "Error de conexión", ciTest: "Probar la conexión",
  ciErr_unauthorized: "La clave es rechazada.", ciErr_disabled: "La interfaz está desactivada en Citas.", ciErr_unreachable: "Citas no responde.",
  ciStartTitle: "Iniciar la peritación desde una cita", ciCrumb: "Cita", ciAppointment: "Cita", ciCustomer: "Cliente", ciInsurance: "Aseguradora", ciCase: "N.º de siniestro", ciVehicle: "Vehículo",
  ciScansOfDay: "Escaneos de este día", ciNoScansDay: "Ningún escaneo de esta estación ese día. Inicie sin escaneo o muestre todos los escaneos.",
  ciAllScans: "Mostrar todos los escaneos (otras estaciones y días)", ciMatch: "Matrícula coincidente",
  ciStartWith: "Iniciar con este escaneo", ciStartWithout: "Iniciar sin escaneo", ciStarting: "Iniciando …",
  ciPlateMismatch: "La matrícula del escaneo ({scan}) difiere de la de la cita ({appt}). ¿Iniciar de todos modos?",
  ciAlready: "Ya se inició una peritación para esta cita.", ciOpen: "Abrir la peritación", ciNotFound: "Cita no encontrada.",
};

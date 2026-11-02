/** V10 strings: editable recipients in the send dialog (estimate / repair report). German, English, French and Spanish (same keys). */
export const deV10 = {
  v10AddPlaceholder: "Adresse hinzufügen …", v10BadEmail: "Ungültige E-Mail-Adresse.", v10MaxRecipients: "Höchstens {n} Empfänger.",
  v10Restore: "Standardadressen wiederherstellen", v10SrcBodyshop: "Carrosserie", v10SrcInsurer: "Versicherung", v10NeedOne: "Mindestens ein Empfänger ist erforderlich.",
  v10OnlyThisSend: "Die Änderung gilt nur für diesen Versand, nicht für die Stammdaten.",
};
export const enV10: Record<keyof typeof deV10, string> = {
  v10AddPlaceholder: "Add an address …", v10BadEmail: "Invalid e-mail address.", v10MaxRecipients: "At most {n} recipients.",
  v10Restore: "Restore default addresses", v10SrcBodyshop: "Body shop", v10SrcInsurer: "Insurer", v10NeedOne: "At least one recipient is required.",
  v10OnlyThisSend: "The change only applies to this send, not to the saved records.",
};
export const frV10: Record<keyof typeof deV10, string> = {
  v10AddPlaceholder: "Ajouter une adresse …", v10BadEmail: "Adresse e-mail invalide.", v10MaxRecipients: "{n} destinataires au maximum.",
  v10Restore: "Rétablir les adresses par défaut", v10SrcBodyshop: "Carrosserie", v10SrcInsurer: "Assurance", v10NeedOne: "Au moins un destinataire est requis.",
  v10OnlyThisSend: "La modification ne vaut que pour cet envoi, pas pour les fiches.",
};
export const esV10: Record<keyof typeof deV10, string> = {
  v10AddPlaceholder: "Añadir una dirección …", v10BadEmail: "Dirección de correo no válida.", v10MaxRecipients: "Máximo {n} destinatarios.",
  v10Restore: "Restablecer las direcciones por defecto", v10SrcBodyshop: "Taller", v10SrcInsurer: "Aseguradora", v10NeedOne: "Se requiere al menos un destinatario.",
  v10OnlyThisSend: "El cambio solo vale para este envío, no para las fichas.",
};

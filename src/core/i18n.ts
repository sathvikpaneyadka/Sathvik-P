export type SupportedLang = 'en' | 'hi' | 'es' | 'ta';

export interface LanguageStrings {
  langName: string;
  brandSubtitle: string;
  navOverview: string;
  navClinical: string;
  navMap: string;
  navKeypad: string;
  navSpatial: string;
  primaryCta: string;
  prescriptionBtn: string;
  explanationBtn: string;
  ivrWelcome: string;
  smsHelpReply: string;
  complaintEscalatedPrefix: string;
  queueConfirmedPrefix: string;
  nurseStatusPrefix: string;
}

export const TRANSLATIONS: Record<SupportedLang, LanguageStrings> = {
  en: {
    langName: 'English',
    brandSubtitle: 'Unified Clinical & Supply Operations',
    navOverview: 'Overview',
    navClinical: 'Clinical & Queue',
    navMap: 'Dispatch Map',
    navKeypad: 'Keypad & Admin',
    navSpatial: '3D Spatial',
    primaryCta: 'Book Home Nurse',
    prescriptionBtn: '1 · Get Prescription',
    explanationBtn: '2 · Get Explanation',
    ivrWelcome:
      'Welcome to CareGrid. Press 1 for Prescription, 2 for Explanation, 3 for Queue Time and Room, 4 for Nurse Tracking, 9 to Escalate a Complaint, 0 to Change Language.',
    smsHelpReply:
      'CareGrid SMS Commands: RX (Prescription), EXPLAIN (Care Guide), QUEUE (Room & Time), NURSE (Home Visit ETA), COMPLAINT <details> (Auto-Escalate), VERIFY <PIN>.',
    complaintEscalatedPrefix: 'Escalated to supervisor',
    queueConfirmedPrefix: 'Smart Queue Confirmed',
    nurseStatusPrefix: 'Home Nurse Dispatch',
  },
  hi: {
    langName: 'हिन्दी (Hindi)',
    brandSubtitle: 'एकीकृत क्लिनिकल और सप्लाई संचालन',
    navOverview: 'अवलोकन',
    navClinical: 'क्लिनिक और कतार',
    navMap: 'डिस्पैच मैप',
    navKeypad: 'कीपैड और एडमिन',
    navSpatial: '3D स्पेस',
    primaryCta: 'होम नर्स बुक करें',
    prescriptionBtn: '1 · प्रिस्क्रिप्शन सुनें',
    explanationBtn: '2 · रोग विवरण सुनें',
    ivrWelcome:
      'केयरग्रिड में आपका स्वागत है। प्रिस्क्रिप्शन के लिए 1 दबाएं, विवरण के लिए 2, कतार और कमरा जानने के लिए 3, होम नर्स के लिए 4, शिकायत सुपरवाइज़र को भेजने के लिए 9 दबाएं।',
    smsHelpReply:
      'CareGrid SMS: RX (दवा पर्ची), EXPLAIN (विवरण), QUEUE (कमरा व समय), NURSE (नर्स स्थिति), COMPLAINT <विवरण> (सुपरवाइज़र को भेजें), VERIFY <PIN>.',
    complaintEscalatedPrefix: 'सुपरवाइज़र को भेजा गया',
    queueConfirmedPrefix: 'स्मार्ट कतार पक्की',
    nurseStatusPrefix: 'होम नर्स अपडेट',
  },
  es: {
    langName: 'Español',
    brandSubtitle: 'Operaciones Clínicas y Suministro Médico',
    navOverview: 'Resumen',
    navClinical: 'Clínica y Turnos',
    navMap: 'Mapa en Vivo',
    navKeypad: 'Teclado y Admin',
    navSpatial: 'Vista 3D',
    primaryCta: 'Reservar Enfermera',
    prescriptionBtn: '1 · Ver Receta',
    explanationBtn: '2 · Ver Explicación',
    ivrWelcome:
      'Bienvenido a CareGrid. Presione 1 para Receta, 2 para Explicación Médica, 3 para Sala y Hora de Turno, 4 para Enfermera a Domicilio, 9 para Escalar una Queja.',
    smsHelpReply:
      'Comandos SMS CareGrid: RX (Receta), EXPLAIN (Explicación), QUEUE (Sala y Hora), NURSE (Estado Enfermera), COMPLAINT <texto> (Supervisor), VERIFY <PIN>.',
    complaintEscalatedPrefix: 'Escalado al supervisor',
    queueConfirmedPrefix: 'Turno Inteligente Confirmado',
    nurseStatusPrefix: 'Despacho de Enfermera',
  },
  ta: {
    langName: 'தமிழ் (Tamil)',
    brandSubtitle: 'மருத்துவ மற்றும் விநியோக மேலாண்மை',
    navOverview: 'முகப்பு',
    navClinical: 'சிகிச்சை & வரிசை',
    navMap: 'நேரடி வரைபடம்',
    navKeypad: 'கீபேட் & நிர்வாகம்',
    navSpatial: '3D காட்சி',
    primaryCta: 'நர்ஸ் முன்பதிவு',
    prescriptionBtn: '1 · மருந்துச் சீட்டு',
    explanationBtn: '2 · விளக்கம் பெறுக',
    ivrWelcome:
      'CareGrid-க்கு வரவேற்கிறோம். மருந்துச் சீட்டுக்கு 1, விளக்கத்திற்கு 2, அறை மற்றும் நேரத்திற்கு 3, நர்ஸ் நிலைக்கு 4, புகார் தெரிவிக்க 9 அழுத்தவும்.',
    smsHelpReply:
      'CareGrid SMS: RX (மருந்து), EXPLAIN (விளக்கம்), QUEUE (அறை/நேரம்), NURSE (நர்ஸ் நிலை), COMPLAINT <விவரம்> (மேற்பார்வையாளர்), VERIFY <PIN>.',
    complaintEscalatedPrefix: 'மேற்பார்வையாளருக்கு அனுப்பப்பட்டது',
    queueConfirmedPrefix: 'ஸ்மார்ட் வரிசை உறுதி',
    nurseStatusPrefix: 'வீட்டு நர்ஸ் தகவல்',
  },
};

export function getLocaleStrings(lang: string): LanguageStrings {
  if (lang === 'hi' || lang === 'es' || lang === 'ta') {
    return TRANSLATIONS[lang];
  }
  return TRANSLATIONS.en;
}

export function cycleLanguage(current: SupportedLang): SupportedLang {
  const order: SupportedLang[] = ['en', 'hi', 'es', 'ta'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

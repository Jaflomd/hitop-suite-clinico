import { FACETS as PID5_FACETS } from "./data/pid5-data.js";
export function buildReport(instrument, items, responses) {
  const accessor = createAccessor(items, responses);

  switch (instrument.id) {
    case "pid5":
      return buildPid5Report(items, responses);
    case "phq9":
      return buildSimpleSumReport({
        summary: "El PHQ-9 resume severidad depresiva reciente.",
        total: sumRange(accessor, 1, 9),
        max: 27,
        label: "Puntaje total PHQ-9",
        bands: [
          { max: 4, label: "Minima o ausente" },
          { max: 9, label: "Leve" },
          { max: 14, label: "Moderada" },
          { max: 19, label: "Moderadamente grave" },
          { max: 27, label: "Grave" },
        ],
        alerts: accessor(9) > 0 ? ["El item 9 fue positivo: revisar riesgo suicida de forma clinica."] : [],
        dimensions: [
          makeDimension("Internalizing · distress", percent(sumRange(accessor, 1, 9), 27), `${sumRange(accessor, 1, 9)}/27`, "Sintomas depresivos."),
        ],
      });
    case "phq2":
      return buildSimpleSumReport({
        summary: "El PHQ-2 concentra anhedonia y animo bajo.",
        total: sumRange(accessor, 1, 2),
        max: 6,
        label: "Puntaje total PHQ-2",
        bands: [
          { max: 2, label: "Bajo" },
          { max: 6, label: "Posible caso si >= 3" },
        ],
        alerts: sumRange(accessor, 1, 2) >= 3 ? ["Punto de corte positivo para cribado de depresion."] : [],
        dimensions: [makeDimension("Depressive distress", percent(sumRange(accessor, 1, 2), 6), `${sumRange(accessor, 1, 2)}/6`, "Cribado ultrabreve.")],
      });
    case "gad7":
      return buildSimpleSumReport({
        summary: "El GAD-7 organiza severidad de ansiedad generalizada.",
        total: sumRange(accessor, 1, 7),
        max: 21,
        label: "Puntaje total GAD-7",
        bands: [
          { max: 4, label: "Minima" },
          { max: 9, label: "Leve" },
          { max: 14, label: "Moderada" },
          { max: 21, label: "Grave" },
        ],
        alerts: sumRange(accessor, 1, 7) >= 10 ? ["Punto de corte positivo para ansiedad clinicamente relevante."] : [],
        dimensions: [makeDimension("Internalizing · fear", percent(sumRange(accessor, 1, 7), 21), `${sumRange(accessor, 1, 7)}/21`, "Ansiedad generalizada.")],
      });
    case "gad2":
      return buildSimpleSumReport({
        summary: "El GAD-2 resume nerviosismo y preocupacion fuera de control.",
        total: sumRange(accessor, 1, 2),
        max: 6,
        label: "Puntaje total GAD-2",
        bands: [{ max: 2, label: "Bajo" }, { max: 6, label: "Posible caso si >= 3" }],
        alerts: sumRange(accessor, 1, 2) >= 3 ? ["Punto de corte positivo para cribado de ansiedad."] : [],
        dimensions: [makeDimension("Fear anxiety", percent(sumRange(accessor, 1, 2), 6), `${sumRange(accessor, 1, 2)}/6`, "Cribado breve.")],
      });
    case "phq4": {
      const depression = sumRange(accessor, 1, 2);
      const anxiety = sumRange(accessor, 3, 4);
      const total = depression + anxiety;
      return {
        summary: "El PHQ-4 integra distress depresivo y ansioso en un cribado muy breve.",
        scores: [
          buildScore("Total PHQ-4", total, 12, bandLabel(total, [{ max: 2, label: "Normal" }, { max: 5, label: "Leve" }, { max: 8, label: "Moderado" }, { max: 12, label: "Severo" }])),
          buildScore("Subescala depresiva", depression, 6, depression >= 3 ? "Positiva" : "No positiva"),
          buildScore("Subescala ansiosa", anxiety, 6, anxiety >= 3 ? "Positiva" : "No positiva"),
        ],
        alerts: [
          ...(depression >= 3 ? ["La subescala depresiva fue positiva."] : []),
          ...(anxiety >= 3 ? ["La subescala ansiosa fue positiva."] : []),
        ],
        dimensions: [
          makeDimension("Internalizing · distress", percent(depression, 6), `${depression}/6`, "Componente depresivo."),
          makeDimension("Internalizing · fear", percent(anxiety, 6), `${anxiety}/6`, "Componente ansioso."),
        ],
        tables: [],
      };
    }
    case "k10": {
      const total = sumRange(accessor, 1, 10);
      return buildSimpleSumReport({
        summary: "La K10 resume malestar psicologico general del ultimo mes.",
        total,
        max: 50,
        label: "Puntaje total K10",
        bands: [{ max: 19, label: "Probablemente bien" }, { max: 24, label: "Leve" }, { max: 29, label: "Moderado" }, { max: 50, label: "Severo" }],
        alerts: total >= 30 ? ["Malestar psicologico severo segun K10."] : [],
        dimensions: [makeDimension("General distress", percent(total - 10, 40), `${total}/50`, "Malestar inespecifico.")],
      });
    }
    case "k6": {
      const raw = sumRange(accessor, 1, 6);
      const adjusted = raw - 6;
      return buildSimpleSumReport({
        summary: "La K6 comprime la carga de distress severo en 6 items.",
        total: adjusted,
        max: 24,
        label: "Puntaje ajustado K6",
        bands: [{ max: 4, label: "Bajo" }, { max: 12, label: "Moderado" }, { max: 24, label: "Elevado" }],
        alerts: adjusted >= 13 ? ["Punto de corte positivo para distress severo."] : [],
        dimensions: [makeDimension("General distress", percent(adjusted, 24), `${adjusted}/24`, "Version reducida K6.")],
      });
    }
    case "who5": {
      const raw = sumRange(accessor, 1, 5);
      const pct = raw * 4;
      return {
        summary: "El WHO-5 se lee al reves: a menor puntuacion, menor bienestar.",
        scores: [
          buildScore("Puntaje bruto", raw, 25, rawBand(raw, [{ max: 7, label: "Muy bajo" }, { max: 12, label: "Bajo" }, { max: 18, label: "Intermedio" }, { max: 25, label: "Bueno" }])),
          buildScore("Indice porcentual", pct, 100, pct <= 28 ? "Muy bajo" : pct < 50 ? "Bajo" : "Adecuado"),
        ],
        alerts: [
          ...(pct < 50 ? ["Bienestar bajo: sugiere revisar sintomas depresivos."] : []),
          ...(pct <= 28 ? ["Punto de corte muy bajo, compatible con probable depresion."] : []),
        ],
        dimensions: [makeDimension("Wellbeing", pct, `${pct}/100`, "A mayor puntaje, mayor bienestar.")],
        tables: [],
      };
    }
    case "swls5": {
      const total = sumRange(accessor, 1, 5);
      return buildSimpleSumReport({
        summary: "La SWLS-5 describe satisfaccion global con la vida.",
        total,
        max: 25,
        label: "Puntaje total SWLS-5",
        bands: [{ max: 9, label: "Muy baja" }, { max: 14, label: "Baja" }, { max: 19, label: "Ligeramente baja" }, { max: 20, label: "Neutral" }, { max: 25, label: "Satisfecha" }],
        alerts: [],
        dimensions: [makeDimension("Life satisfaction", percent(total - 5, 20), `${total}/25`, "A mayor puntaje, mayor satisfaccion.")],
      });
    }
    case "whodas12": {
      const total = sumRange(accessor, 1, 12);
      const scaled = roundTo(((total - 12) / 48) * 100, 1);
      const domains = [
        ["Comprension y comunicacion", meanValues([accessor(3), accessor(6)])],
        ["Movilidad", meanValues([accessor(1), accessor(7)])],
        ["Autocuidado", meanValues([accessor(8), accessor(9)])],
        ["Relacionarse", meanValues([accessor(10), accessor(11)])],
        ["Actividades de vida", meanValues([accessor(2), accessor(12)])],
        ["Participacion", meanValues([accessor(4), accessor(5)])],
      ];
      return {
        summary: "El WHODAS resume discapacidad funcional reciente en seis dominios.",
        scores: [
          buildScore("Suma simple", total, 60, rawBand(total, [{ max: 20, label: "Baja" }, { max: 35, label: "Intermedia" }, { max: 60, label: "Alta" }])),
          buildScore("Escala 0-100", scaled, 100, scaled >= 50 ? "Limitacion alta" : "Limitacion baja a media"),
        ],
        alerts: [],
        dimensions: [makeDimension("Global disability", scaled, `${scaled}/100`, "Mayor puntaje = mayor limitacion funcional.")],
        tables: [
          {
            title: "Dominios funcionales",
            columns: ["Dominio", "Promedio"],
            rows: domains.map(([label, value]) => [label, formatNumber(value)]),
          },
        ],
      };
    }
    case "aq10": {
      const positive = countAq10(accessor);
      return buildSimpleSumReport({
        summary: "El AQ-10 cuenta respuestas que sugieren rasgos autistas.",
        total: positive,
        max: 10,
        label: "Respuestas positivas AQ-10",
        bands: [{ max: 5, label: "Por debajo del punto de corte" }, { max: 10, label: "Punto de corte positivo" }],
        alerts: positive >= 6 ? ["AQ-10 positivo: considerar evaluacion diagnostica completa."] : [],
        dimensions: [makeDimension("Autistic traits", percent(positive, 10), `${positive}/10`, "Cribado breve de rasgos.")],
      });
    }
    case "asrs6": {
      const raw = sumRange(accessor, 1, 6);
      const screenCount = countAsrsPartA(accessor, 6);
      return {
        summary: "La Parte A del ASRS concentra los items mas predictivos para cribado.",
        scores: [
          buildScore("Cribado Parte A", screenCount, 6, screenCount >= 4 ? "Positivo" : "No positivo"),
          buildScore("Puntaje crudo", raw, 24, rawBand(raw, [{ max: 8, label: "Bajo" }, { max: 16, label: "Intermedio" }, { max: 24, label: "Alto" }])),
        ],
        alerts: screenCount >= 4 ? ["Parte A positiva: sintomas altamente consistentes con TDAH en adultos."] : [],
        dimensions: [makeDimension("Attention / hyperactivity", percent(raw, 24), `${raw}/24`, "Cribado breve de TDAH.")],
        tables: [],
      };
    }
    case "asrs18": {
      const raw = sumRange(accessor, 1, 18);
      const partA = countAsrsPartA(accessor, 18);
      const partB = sumRange(accessor, 7, 18);
      return {
        summary: "La version completa del ASRS amplia detalle sobre inatencion, inquietud e impulsividad.",
        scores: [
          buildScore("Cribado Parte A", partA, 6, partA >= 4 ? "Positivo" : "No positivo"),
          buildScore("Puntaje total", raw, 72, rawBand(raw, [{ max: 24, label: "Bajo" }, { max: 48, label: "Intermedio" }, { max: 72, label: "Alto" }])),
          buildScore("Parte B", partB, 48, rawBand(partB, [{ max: 16, label: "Baja carga" }, { max: 32, label: "Carga intermedia" }, { max: 48, label: "Carga alta" }])),
        ],
        alerts: partA >= 4 ? ["Parte A positiva: vale la pena evaluacion clinica de TDAH."] : [],
        dimensions: [
          makeDimension("Attention dysregulation", percent(sumRange(accessor, 1, 9), 36), `${sumRange(accessor, 1, 9)}/36`, "Inatencion y organizacion."),
          makeDimension("Hyperactivity / impulsivity", percent(sumRange(accessor, 10, 18), 36), `${sumRange(accessor, 10, 18)}/36`, "Actividad, inquietud e impulsividad."),
        ],
        tables: [],
      };
    }
    case "audit": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El AUDIT organiza consumo, sintomas de dependencia y dano por alcohol.",
        total,
        max: 40,
        label: "Puntaje total AUDIT",
        bands: [{ max: 7, label: "Zona I · bajo riesgo" }, { max: 15, label: "Zona II · riesgo" }, { max: 19, label: "Zona III · perjudicial" }, { max: 40, label: "Zona IV · posible dependencia" }],
        alerts: total >= 20 ? ["Zona IV: posible dependencia, conviene evaluacion especializada."] : total >= 8 ? ["AUDIT positivo para consumo de riesgo o perjudicial."] : [],
        dimensions: [
          makeDimension("Alcohol use risk", percent(total, 40), `${total}/40`, "Mayor puntaje = mayor severidad."),
          makeDimension("Alcohol pattern", percent(sumRange(accessor, 1, 3), 12), `${sumRange(accessor, 1, 3)}/12`, "Frecuencia e intensidad de consumo."),
        ],
      });
    }
    case "auditc": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El AUDIT-C resume patron de consumo alcoholico reciente.",
        total,
        max: 12,
        label: "Puntaje total AUDIT-C",
        bands: [{ max: 3, label: "Bajo" }, { max: 12, label: "Riesgo elevado" }],
        alerts: total >= 4 ? ["Punto de corte positivo de forma general; considerar diferencias por sexo biologico."] : [],
        dimensions: [makeDimension("Alcohol risk", percent(total, 12), `${total}/12`, "Version breve del AUDIT.")],
      });
    }
    case "dudit": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El DUDIT resume riesgo y posible dependencia por drogas distintas al alcohol.",
        total,
        max: 44,
        label: "Puntaje total DUDIT",
        bands: [{ max: 1, label: "Sin riesgo o minimo" }, { max: 5, label: "Bajo" }, { max: 24, label: "Riesgo / perjudicial" }, { max: 44, label: "Posible dependencia" }],
        alerts: total >= 25 ? ["Puntaje compatible con posible dependencia."] : total >= 6 ? ["Puntaje compatible con consumo de riesgo/perjudicial."] : [],
        dimensions: [makeDimension("Drug use risk", percent(total, 44), `${total}/44`, "Mayor puntaje = mayor problema de consumo.")],
      });
    }
    case "cageaid": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El CAGE-AID es un cribado rapido para alcohol y drogas.",
        total,
        max: 4,
        label: "Puntaje total CAGE-AID",
        bands: [{ max: 1, label: "Bajo" }, { max: 4, label: "Positivo si >= 2" }],
        alerts: total >= 2 ? ["Cribado positivo para problemas con alcohol o drogas."] : [],
        dimensions: [makeDimension("Dependence risk", percent(total, 4), `${total}/4`, "Screening rapido.")],
      });
    }
    case "cuditr": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El CUDIT-R orienta riesgo y posible trastorno por consumo de cannabis.",
        total,
        max: 32,
        label: "Puntaje total CUDIT-R",
        bands: [{ max: 7, label: "Bajo" }, { max: 11, label: "Consumo riesgoso" }, { max: 32, label: "Probable trastorno por consumo" }],
        alerts: total >= 12 ? ["CUDIT-R en rango de probable trastorno por consumo de cannabis."] : total >= 8 ? ["CUDIT-R en rango de consumo riesgoso."] : [],
        dimensions: [makeDimension("Cannabis risk", percent(total, 32), `${total}/32`, "Mayor puntaje = mayor severidad.")],
      });
    }
    case "ftnd": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El FTND estima gravedad de dependencia a nicotina.",
        total,
        max: 10,
        label: "Puntaje total FTND",
        bands: [{ max: 2, label: "Muy baja" }, { max: 4, label: "Baja" }, { max: 5, label: "Media" }, { max: 7, label: "Alta" }, { max: 10, label: "Muy alta" }],
        alerts: total >= 6 ? ["Dependencia nicotinica alta o muy alta."] : [],
        dimensions: [makeDimension("Nicotine dependence", percent(total, 10), `${total}/10`, "Dependencia a nicotina.")],
      });
    }
    case "pcl5": {
      const total = sumRange(accessor, 1, 20);
      const b = sumRange(accessor, 1, 5);
      const c = sumRange(accessor, 6, 7);
      const d = sumRange(accessor, 8, 14);
      const e = sumRange(accessor, 15, 20);
      const probable = total >= 31 && countAtLeast(accessor, [1, 2, 3, 4, 5], 2) >= 1 && countAtLeast(accessor, [6, 7], 2) >= 1 && countAtLeast(accessor, [8, 9, 10, 11, 12, 13, 14], 2) >= 2 && countAtLeast(accessor, [15, 16, 17, 18, 19, 20], 2) >= 2;
      return {
        summary: "El PCL-5 entrega severidad total y lectura por clusters DSM-5.",
        scores: [
          buildScore("Puntaje total PCL-5", total, 80, total >= 31 ? "Rango probable de TEPT" : "Por debajo del punto de corte"),
          buildScore("Cluster B", b, 20, ""),
          buildScore("Cluster C", c, 8, ""),
          buildScore("Cluster D", d, 28, ""),
          buildScore("Cluster E", e, 24, ""),
        ],
        alerts: probable ? ["Cumple algoritmo provisional DSM-5 para probable TEPT."] : total >= 31 ? ["Puntaje alto, aunque el algoritmo completo no se cumple del todo."] : [],
        dimensions: [
          makeDimension("Traumatic stress", percent(total, 80), `${total}/80`, "Carga sintomatica total."),
          makeDimension("Hyperarousal", percent(e, 24), `${e}/24`, "Activacion / reactividad."),
        ],
        tables: [
          {
            title: "Clusters DSM-5",
            columns: ["Cluster", "Puntaje"],
            rows: [
              ["B · Reexperimentacion", String(b)],
              ["C · Evitacion", String(c)],
              ["D · Cognicion / animo", String(d)],
              ["E · Reactividad", String(e)],
            ],
          },
        ],
      };
    }
    case "pcptsd5": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El PC-PTSD-5 es un cribado breve de sintomas postraumaticos.",
        total,
        max: 5,
        label: "Puntaje total PC-PTSD-5",
        bands: [{ max: 2, label: "No positivo" }, { max: 5, label: "Positivo si >= 3" }],
        alerts: total >= 3 ? ["Cribado positivo para sintomas postraumaticos."] : [],
        dimensions: [makeDimension("Traumatic stress", percent(total, 5), `${total}/5`, "Cribado rapido postraumatico.")],
      });
    }
    case "ace10": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El ACE-10 estima carga de adversidad temprana.",
        total,
        max: 10,
        label: "Puntaje total ACE",
        bands: [{ max: 0, label: "Sin ACEs" }, { max: 1, label: "Baja carga" }, { max: 3, label: "Carga moderada" }, { max: 10, label: "Carga alta" }],
        alerts: total >= 4 ? ["Carga ACE alta: mayor vulnerabilidad acumulativa a largo plazo."] : [],
        dimensions: [makeDimension("Developmental adversity", percent(total, 10), `${total}/10`, "Carga acumulada de experiencias adversas.")],
      });
    }
    case "cape15": {
      const frequency = meanValues(items.map((item) => getObjectPromptValue(responses[item.id], "frequency")));
      const distress = meanValues(items.map((item) => getObjectPromptValue(responses[item.id], "distress")));
      const burden = roundTo(((frequency - 1) + (distress - 1)) / 6 * 100, 0);
      return {
        summary: "El CAPE-15 mira frecuencia de experiencias psicotiformes y cuanto malestar generan.",
        scores: [
          buildScore("Frecuencia media", frequency, 4, bandLabel(frequency, [{ max: 1.49, label: "Baja" }, { max: 2.49, label: "Intermedia" }, { max: 4, label: "Alta" }])),
          buildScore("Malestar medio", distress, 4, bandLabel(distress, [{ max: 1.49, label: "Bajo" }, { max: 2.49, label: "Intermedio" }, { max: 4, label: "Alto" }])),
        ],
        alerts: burden >= 50 ? ["La combinacion de frecuencia y malestar sugiere revisar experiencias inusuales con mayor detalle."] : [],
        dimensions: [
          makeDimension("Thought disorder proneness", burden, `${formatNumber(frequency)} / ${formatNumber(distress)}`, "Resumen exploratorio de frecuencia + malestar."),
        ],
        tables: [],
      };
    }
    case "hcl32": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El HCL-32 suma periodos de activacion/hipomania referidos por la persona.",
        total,
        max: 32,
        label: "Respuestas afirmativas",
        bands: [{ max: 13, label: "Por debajo del punto de corte" }, { max: 32, label: "Posible espectro bipolar" }],
        alerts: total >= 14 ? ["HCL-32 positivo: alta probabilidad de espectro bipolar, especialmente tipo II."] : [],
        dimensions: [makeDimension("Mania activation", percent(total, 32), `${total}/32`, "Activacion / hipomania referida.")],
      });
    }
    case "lpfsbf": {
      const identity = meanRange(accessor, 1, 3);
      const selfDirection = meanRange(accessor, 4, 6);
      const empathy = meanRange(accessor, 7, 9);
      const intimacy = meanRange(accessor, 10, 12);
      const total = sumRange(accessor, 1, 12);
      return {
        summary: "El LPFS-BF organiza el deterioro de funcionamiento de personalidad en cuatro dominios.",
        scores: [
          buildScore("Puntaje total", total, 48, rawBand(total, [{ max: 20, label: "Bajo" }, { max: 32, label: "Intermedio" }, { max: 48, label: "Alto" }])),
          buildScore("Promedio global", roundTo(total / 12, 2), 4, ""),
        ],
        alerts: [],
        dimensions: [makeDimension("Personality functioning", percent(total - 12, 36), `${total}/48`, "Mayor puntaje = mayor deterioro.")],
        tables: [
          {
            title: "Dominios LPFS-BF",
            columns: ["Dominio", "Promedio"],
            rows: [
              ["Identidad", formatNumber(identity)],
              ["Autodireccion", formatNumber(selfDirection)],
              ["Empatia", formatNumber(empathy)],
              ["Intimidad", formatNumber(intimacy)],
            ],
          },
        ],
      };
    }
    case "pg13r": {
      const hasLoss = accessor(1) === 1;
      const months = accessor(2) ?? 0;
      const total = sumRange(accessor, 3, 12);
      const core = Math.max(accessor(3) || 0, accessor(4) || 0);
      const accessory = countAtLeast(accessor, [5, 6, 7, 8, 9, 10, 11, 12], 4);
      const impact = accessor(13) === 1;
      const probable = hasLoss && months >= 12 && core >= 4 && accessory >= 3 && impact;
      return {
        summary: "El PG-13-R combina puerta de entrada, severidad y algoritmo provisional para duelo prolongado.",
        scores: [
          buildScore("Puntaje sintomatico", total, 50, total >= 30 ? "Elevado" : "Bajo a intermedio"),
          buildScore("Meses desde la perdida", months, Math.max(12, months), months >= 12 ? "Criterio temporal DSM-5-TR" : "Menos de 12 meses"),
        ],
        alerts: [
          ...(hasLoss ? [] : ["No se confirmo la perdida significativa en el filtro inicial."]),
          ...(probable ? ["Algoritmo DSM-5-TR provisional positivo para duelo prolongado."] : []),
        ],
        dimensions: [makeDimension("Prolonged grief", percent(total - 10, 40), `${total}/50`, "Severidad de sintomas de duelo prolongado.")],
        tables: [],
      };
    }
    case "phq15": {
      const total = sumRange(accessor, 1, 15);
      return buildSimpleSumReport({
        summary: "El PHQ-15 resume carga de sintomas somaticos.",
        total,
        max: 30,
        label: "Puntaje total PHQ-15",
        bands: [{ max: 4, label: "Minima" }, { max: 9, label: "Baja" }, { max: 14, label: "Media" }, { max: 30, label: "Alta" }],
        alerts: total >= 15 ? ["Carga somatica alta en el PHQ-15."] : [],
        dimensions: [makeDimension("Somatoform burden", percent(total, 30), `${total}/30`, "Carga somatica percibida.")],
      });
    }
    case "sss8": {
      const total = sumRange(accessor, 1, 8);
      return buildSimpleSumReport({
        summary: "El SSS-8 ofrece una lectura rapida de carga somatica de la ultima semana.",
        total,
        max: 32,
        label: "Puntaje total SSS-8",
        bands: [{ max: 3, label: "Minima" }, { max: 7, label: "Baja" }, { max: 11, label: "Media" }, { max: 15, label: "Alta" }, { max: 32, label: "Muy alta" }],
        alerts: total >= 16 ? ["Carga somatica muy alta en el SSS-8."] : [],
        dimensions: [makeDimension("Somatic symptom severity", percent(total, 32), `${total}/32`, "Molestia somatica reciente.")],
      });
    }
    case "isi": {
      const total = sumRange(accessor, 1, 7);
      return buildSimpleSumReport({
        summary: "El ISI resume gravedad percibida del insomnio.",
        total,
        max: 28,
        label: "Puntaje total ISI",
        bands: [{ max: 7, label: "Sin insomnio clinicamente significativo" }, { max: 14, label: "Subumbral" }, { max: 21, label: "Moderado" }, { max: 28, label: "Severo" }],
        alerts: total >= 15 ? ["Insomnio clinicamente relevante en el ISI."] : [],
        dimensions: [makeDimension("Sleep disturbance", percent(total, 28), `${total}/28`, "Problemas de inicio/mantenimiento y preocupacion por el sueno.")],
      });
    }
    case "ess": {
      const total = sumRange(accessor, 1, 8);
      return buildSimpleSumReport({
        summary: "La ESS estima somnolencia diurna en situaciones cotidianas.",
        total,
        max: 24,
        label: "Puntaje total ESS",
        bands: [{ max: 10, label: "Normal" }, { max: 12, label: "Leve" }, { max: 15, label: "Moderada" }, { max: 24, label: "Alta" }],
        alerts: total >= 11 ? ["Somnolencia diurna excesiva en la ESS."] : [],
        dimensions: [makeDimension("Daytime sleepiness", percent(total, 24), `${total}/24`, "Probabilidad de quedarse dormido/a.")],
      });
    }
    case "pss10": {
      const total = computePss10(accessor);
      return buildSimpleSumReport({
        summary: "La PSS-10 resume la sensacion de sobrecarga y control percibido del ultimo mes.",
        total,
        max: 40,
        label: "Puntaje total PSS-10",
        bands: [{ max: 13, label: "Bajo" }, { max: 26, label: "Moderado" }, { max: 40, label: "Alto" }],
        alerts: total >= 27 ? ["Estres percibido alto en la PSS-10."] : [],
        dimensions: [makeDimension("Stress load", percent(total, 40), `${total}/40`, "Estres percibido global.")],
      });
    }
    case "scoff": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El SCOFF es un cribado muy breve de posible patologia alimentaria.",
        total,
        max: 5,
        label: "Respuestas afirmativas",
        bands: [{ max: 1, label: "No positivo" }, { max: 5, label: "Positivo si >= 2" }],
        alerts: total >= 2 ? ["SCOFF positivo: conviene explorar TCA con mayor detalle."] : [],
        dimensions: [makeDimension("Eating pathology risk", percent(total, 5), `${total}/5`, "Cribado breve de TCA.")],
      });
    }
    case "ucla3": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "La UCLA-3 resume soledad subjetiva.",
        total,
        max: 9,
        label: "Puntaje total UCLA-3",
        bands: [{ max: 4, label: "Baja" }, { max: 6, label: "Moderada" }, { max: 9, label: "Alta" }],
        alerts: total >= 7 ? ["Soledad subjetiva alta."] : [],
        dimensions: [makeDimension("Loneliness / detachment", percent(total - 3, 6), `${total}/9`, "Percepcion de aislamiento.")],
      });
    }
    case "minispin": {
      const total = sumAllNumeric(items, responses);
      return buildSimpleSumReport({
        summary: "El Mini-SPIN es un cribado breve de ansiedad social.",
        total,
        max: 12,
        label: "Puntaje total Mini-SPIN",
        bands: [{ max: 5, label: "No positivo" }, { max: 12, label: "Positivo si >= 6" }],
        alerts: total >= 6 ? ["Mini-SPIN positivo para ansiedad social clinicamente relevante."] : [],
        dimensions: [makeDimension("Social anxiety", percent(total, 12), `${total}/12`, "Cribado social breve.")],
      });
    }
    case "rses": {
      const total = computeRses(accessor);
      return buildSimpleSumReport({
        summary: "La RSES estima autoestima global.",
        total,
        max: 30,
        label: "Puntaje total RSES",
        bands: [{ max: 14, label: "Autoestima baja" }, { max: 25, label: "Rango habitual" }, { max: 30, label: "Alta" }],
        alerts: total <= 14 ? ["Autoestima baja en la RSES."] : [],
        dimensions: [makeDimension("Self-esteem", percent(total, 30), `${total}/30`, "A mayor puntaje, mayor autoestima.")],
      });
    }
    case "brs": {
      const mean = computeBrs(accessor);
      return {
        summary: "La BRS estima capacidad percibida de recuperacion tras el estres.",
        scores: [buildScore("Promedio BRS", mean, 5, bandLabel(mean, [{ max: 2.99, label: "Baja resiliencia" }, { max: 4.3, label: "Rango habitual" }, { max: 5, label: "Alta resiliencia" }]))],
        alerts: mean < 3 ? ["BRS en rango de resiliencia baja."] : [],
        dimensions: [makeDimension("Resilience", percent(mean - 1, 4), `${formatNumber(mean)} / 5`, "A mayor promedio, mayor resiliencia percibida.")],
        tables: [],
      };
    }
    case "dialog11": {
      const life = meanRange(accessor, 1, 8);
      const treatment = meanRange(accessor, 9, 11);
      const total = meanRange(accessor, 1, 11);
      return {
        summary: "DIALOG-11 diferencia satisfaccion con vida y con tratamiento.",
        scores: [
          buildScore("Promedio global", total, 7, bandLabel(total, [{ max: 2.99, label: "Bajo" }, { max: 4.99, label: "Intermedio" }, { max: 7, label: "Alto" }])),
          buildScore("Vida", life, 7, ""),
          buildScore("Tratamiento", treatment, 7, ""),
        ],
        alerts: [],
        dimensions: [
          makeDimension("Quality of life", percent(total - 1, 6), `${formatNumber(total)} / 7`, "Satisfaccion global."),
          makeDimension("Treatment satisfaction", percent(treatment - 1, 6), `${formatNumber(treatment)} / 7`, "Satisfaccion con apoyos."),
        ],
        tables: [],
      };
    }
    case "lec5": {
      const anyExposure = items.filter((item) => accessor(item.number) > 0).length;
      const directExposure = items.filter((item) => {
        const value = accessor(item.number);
        return value === 4 || value === 5;
      }).length;
      return {
        summary: "El LEC-5 es un inventario de exposicion, no una escala de severidad sintomatica.",
        scores: [
          buildScore("Eventos con alguna exposicion", anyExposure, items.length, ""),
          buildScore("Exposicion directa / laboral", directExposure, items.length, ""),
        ],
        alerts: directExposure >= 1 ? ["Hay al menos un evento con exposicion directa o laboral relevante."] : [],
        dimensions: [makeDimension("Trauma exposure", percent(anyExposure, items.length), `${anyExposure}/${items.length}`, "Carga de exposicion acumulada.")],
        tables: [],
      };
    }
    case "thq": {
      const total = sumAllNumeric(items, responses);
      const crime = sumRange(accessor, 1, 4);
      const general = sumRange(accessor, 5, 17);
      const physical = sumRange(accessor, 18, 24);
      return {
        summary: "El THQ cuenta exposicion a experiencias traumaticas a lo largo de la vida.",
        scores: [
          buildScore("Exposiciones afirmativas", total, items.length, ""),
          buildScore("Crimen", crime, 4, ""),
          buildScore("Desastres / trauma general", general, 13, ""),
          buildScore("Trauma fisico / sexual", physical, 7, ""),
        ],
        alerts: total >= 1 ? ["Hay historia positiva de trauma en el THQ."] : [],
        dimensions: [makeDimension("Trauma exposure", percent(total, items.length), `${total}/${items.length}`, "Conteo de exposiciones afirmativas.")],
        tables: [],
      };
    }
    default:
      return {
        summary: "Instrumento cargado correctamente, pero su regla de scoring aun no fue conectada.",
        scores: [],
        alerts: ["Falta conectar scoring para este instrumento."],
        dimensions: [],
        tables: [],
      };
  }
}

function buildPid5Report(items, responses) {
  const answers = Object.values(responses);
  const facetResults = PID5_FACETS.map((facet) => {
    const values = facet.itemNumbers.map((itemNumber) => {
      const itemId = items[itemNumber - 1]?.id;
      const answer = responses[itemId];
      return facet.reversed ? 3 - answer : answer;
    });
    const rawScore = meanValues(values);
    const zScore = (rawScore - facet.normMean) / facet.normSd;
    return { ...facet, rawScore, zScore };
  });

  const domains = groupBy(facetResults, "domain").map(([domain, rows]) => ({
    domain,
    value: meanValues(rows.map((row) => row.rawScore)),
  }));
  const topFacets = [...facetResults].sort((left, right) => right.zScore - left.zScore).slice(0, 5);

  return {
    summary: "El PID-5 entrega facetas maladaptativas y cinco dominios amplios de personalidad.",
    scores: domains.map((entry) => buildScore(entry.domain, roundTo(entry.value, 2), 3, "")),
    alerts: topFacets.length ? [`Facetas mas elevadas: ${topFacets.map((facet) => facet.name).join(", ")}.`] : [],
    dimensions: domains.map((entry) => makeDimension(entry.domain, percent(entry.value, 3), `${formatNumber(entry.value)} / 3`, "Promedio de facetas del dominio.")),
    tables: [
      {
        title: "Facetas PID-5",
        columns: ["Dominio", "Faceta", "Puntaje", "Z-score"],
        rows: facetResults
          .sort((left, right) => right.zScore - left.zScore)
          .map((facet) => [facet.domain, facet.name, formatNumber(facet.rawScore), formatSignedNumber(facet.zScore)]),
      },
    ],
  };
}

function buildSimpleSumReport({ summary, total, max, label, bands, alerts, dimensions }) {
  return {
    summary,
    scores: [buildScore(label, total, max, bandLabel(total, bands))],
    alerts,
    dimensions,
    tables: [],
  };
}

function createAccessor(items, responses) {
  const idByNumber = new Map(items.map((item) => [item.number, item.id]));
  return (number) => {
    const stored = responses[idByNumber.get(number)];
    return typeof stored === "number" ? stored : null;
  };
}

function sumRange(accessor, start, end) {
  let total = 0;
  for (let number = start; number <= end; number += 1) {
    total += accessor(number) || 0;
  }
  return total;
}

function meanRange(accessor, start, end) {
  const values = [];
  for (let number = start; number <= end; number += 1) {
    values.push(accessor(number) || 0);
  }
  return meanValues(values);
}

function sumAllNumeric(items, responses) {
  return items.reduce((total, item) => {
    const value = responses[item.id];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function countAtLeast(accessor, numbers, threshold) {
  return numbers.filter((number) => (accessor(number) || 0) >= threshold).length;
}

function countAsrsPartA(accessor, maxNumber) {
  const thresholds = {
    1: 3,
    2: 3,
    3: 3,
    4: 2,
    5: 2,
    6: 2,
  };
  return Object.entries(thresholds)
    .filter(([number]) => Number(number) <= maxNumber)
    .filter(([number, threshold]) => (accessor(Number(number)) || 0) >= threshold)
    .length;
}

function countAq10(accessor) {
  const agreeItems = [1, 7, 8, 10];
  const disagreeItems = [2, 3, 4, 5, 6, 9];
  let total = 0;
  agreeItems.forEach((number) => {
    const value = accessor(number);
    if (value !== null && value >= 2) {
      total += 1;
    }
  });
  disagreeItems.forEach((number) => {
    const value = accessor(number);
    if (value !== null && value <= 1) {
      total += 1;
    }
  });
  return total;
}

function computePss10(accessor) {
  const reverseItems = new Set([4, 5, 7, 8]);
  let total = 0;
  for (let number = 1; number <= 10; number += 1) {
    const value = accessor(number) || 0;
    total += reverseItems.has(number) ? 4 - value : value;
  }
  return total;
}

function computeRses(accessor) {
  const reverseItems = new Set([3, 5, 8, 9, 10]);
  let total = 0;
  for (let number = 1; number <= 10; number += 1) {
    const value = accessor(number) || 0;
    total += reverseItems.has(number) ? 3 - value : value;
  }
  return total;
}

function computeBrs(accessor) {
  const reverseItems = new Set([2, 4, 6]);
  const values = [];
  for (let number = 1; number <= 6; number += 1) {
    const value = accessor(number) || 1;
    values.push(reverseItems.has(number) ? 6 - value : value);
  }
  return roundTo(meanValues(values), 2);
}

function getObjectPromptValue(value, key) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value[key] ?? null;
}

function buildScore(label, value, max, band, note = "") {
  return {
    label,
    display: `${formatNumber(value)} / ${formatNumber(max)}`,
    band,
    note,
  };
}

function makeDimension(label, percentValue, valueLabel, note) {
  return {
    label,
    percent: Math.max(0, Math.min(100, roundTo(percentValue, 0))),
    valueLabel,
    note,
  };
}

function bandLabel(value, bands) {
  const match = bands.find((band) => value <= band.max);
  return match ? match.label : bands[bands.length - 1]?.label || "";
}

function rawBand(value, bands) {
  return bandLabel(value, bands);
}

function percent(value, max) {
  if (!max) {
    return 0;
  }
  return (value / max) * 100;
}

function meanValues(values) {
  const clean = values.filter((value) => typeof value === "number");
  if (!clean.length) {
    return 0;
  }
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function groupBy(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const bucket = map.get(row[key]) || [];
    bucket.push(row);
    map.set(row[key], bucket);
  });
  return Array.from(map.entries());
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value) {
  return Number(value).toFixed(Number.isInteger(value) ? 0 : 2);
}

export function formatSignedNumber(value) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

export function buildSummaryText(instrumentName, report) {
  const scoreLines = report.scores.map((entry) => `${entry.label}: ${entry.display}${entry.band ? ` · ${entry.band}` : ""}`).join("\n");
  const dimensionLines = report.dimensions.map((entry) => `${entry.label}: ${entry.valueLabel}`).join("\n");
  return [
    instrumentName,
    "",
    "Puntajes",
    scoreLines,
    "",
    "Reporte dimensional",
    dimensionLines,
    "",
    report.alerts.length ? `Alertas: ${report.alerts.join(" | ")}` : "Sin alertas adicionales.",
  ].join("\n");
}

export function buildTableText(instrumentName, report, tables = report.tables) {
  if (!tables.length) {
    return buildSummaryText(instrumentName, report);
  }
  return tables
    .map((table) => [table.columns.join("\t"), ...table.rows.map((row) => row.join("\t"))].join("\n"))
    .join("\n\n");
}

function inferDefaultSortDirection(columnLabel, rows, columnIndex) {
  const normalized = String(columnLabel).toLowerCase();
  if (/(puntaje|score|z|total|promedio|media|frecuencia|malestar|riesgo|percent|suma)/.test(normalized)) {
    return "desc";
  }

  const numericRows = rows.filter((row) => extractNumericValue(row[columnIndex]) !== null).length;
  if (numericRows && numericRows === rows.length) {
    return "desc";
  }

  return "asc";
}

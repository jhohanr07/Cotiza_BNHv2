"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, Mail } from "lucide-react";
import {
  fetchEquipos,
  fetchVendedores,
  saveQuoteAndSendEmail,
  type Equipo,
} from "@/lib/apps-script-api";

const CATEGORIES = {
 dp: {
    label: "Línea DP y TE Air",
    minAnnualRate: 0.4,
    maxInstallments: 12,
    canPayVATSeparately: false,
    minInitialRate: 0.2,
    hasCommissionNote: false,
  },
  mx: {
    label: "Línea MX",
    minAnnualRate: 0.3,
    maxInstallments: 15,
    canPayVATSeparately: true,
    minInitialRate: 0.2,
    hasCommissionNote: false,
  },
  consonaN5N7: {
    label: "Línea Consona N5-N7",
    minAnnualRate: 0.3,
    maxInstallments: 18,
    canPayVATSeparately: true,
    minInitialRate: 0.2,
    hasCommissionNote: false,
  },
  consonaN8N9: {
    label: "Línea Consona N8-N9",
    minAnnualRate: 0.3,
    maxInstallments: 18,
    canPayVATSeparately: true,
    minInitialRate: 0.2,
    hasCommissionNote: false,
  },
  alta: {
   label: "Alta Gama",
   minAnnualRate: 0.2,
   maxInstallments: 24,
   canPayVATSeparately: true,
   minInitialRate: 0.2,
   hasCommissionNote: false,
  },
  congresoMX: {
    label: "Congreso Cardiologìa",
    // Spec escrito: AIRR 25%. La imagen de referencia muestra 30.26%
    // (target 30%). Si la imagen es la referencia válida, cambiar a 0.3.
    minAnnualRate: 0.25,
    maxInstallments: 18,
    canPayVATSeparately: true,
    minInitialRate: 0.2,
    hasCommissionNote: true,
  },
  congresoConsona: {
  label: "Congreso Consona",
   minAnnualRate: 0.2,
   maxInstallments: 18,
   canPayVATSeparately: true,
   minInitialRate: 0.18,
   hasCommissionNote: true,
  },
} as const;

const VAT_RATE = 0.16;
const MIN_INITIAL_RATE = 0.2;
const SUGGESTED_INITIAL_RATE = 0.25;
const ACCESS_PASSWORD = "BNH2026";

// --- Reglas de financiamiento por factor ---
// Interés = (Base imponible - Inicial) x factor
//   · menos de 18 cuotas  -> 20%
//   · 18 cuotas o más     -> 25%
const FINANCING_TERM_THRESHOLD = 18;
const FINANCING_FACTOR_SHORT = 0.2;
const FINANCING_FACTOR_LONG = 0.25;

// Inicial mínima absoluta (USD) y paso de redondeo para la inicial sugerida
const MIN_INITIAL_AMOUNT = 5000;
const INITIAL_STEP = 500;
// Descuento visual sobre el I.V.A. del panel de Contado (interruptor "Ajustar")
const AJUSTE_IVA_DESCUENTO = 0.35;

type PaymentMode = "si" | "no";

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "$0.00";

  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function roundUpToNearest5(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 5) * 5;
}

function getFinancingFactor(installments: number) {
  return installments >= FINANCING_TERM_THRESHOLD
    ? FINANCING_FACTOR_LONG
    : FINANCING_FACTOR_SHORT;
}

function roundUpToMultiple(value: number, step: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / step) * step;
}

function formatNumberInput(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

export default function Page() {
  const [isAuthenticated, setIsAuthenticated] =
    useState(false);

  const [password, setPassword] =
    useState("");

  const [accessError, setAccessError] =
    useState("");

  const handleLogin = () => {
    if (password === ACCESS_PASSWORD) {
      setIsAuthenticated(true);
      setAccessError("");
    } else {
      setAccessError("Clave incorrecta.");
    }
  };

  if (!isAuthenticated) {
    return (
      <div
        className="min-h-screen bg-[#f3f5f7] px-6 py-10"
        style={{
          fontFamily:
            "Verdana, sans-serif",
        }}
      >
        <div className="mx-auto flex max-w-md flex-col items-center justify-center">
          <div className="mb-8 rounded-3xl bg-white px-8 py-6 shadow-sm ring-1 ring-gray-200">
            <Image
              src="/logo-bnh.jpeg"
              alt="BNH Medical"
              width={360}
              height={180}
              className="h-auto w-[280px] md:w-[340px]"
              priority
            />
          </div>

          <Card className="w-full rounded-3xl border-0 bg-white shadow-lg ring-1 ring-gray-200">
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-3xl font-bold text-gray-900">
                Acceso privado
              </CardTitle>

              <p className="mt-2 text-sm text-gray-600">
                Ingrese la clave para acceder
                a la calculadora de
                financiamiento
              </p>
            </CardHeader>

            <CardContent className="space-y-5 pt-4">
              <div className="space-y-3">
                <Label className="block text-base font-medium text-gray-800">
                  Clave de acceso
                </Label>

                <Input
                  type="password"
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                  placeholder="Ingrese su clave"
                  className="h-12 rounded-xl"
                />
              </div>

              {accessError && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertDescription>
                    {accessError}
                  </AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleLogin}
                className="h-12 w-full rounded-xl bg-[#0d6f91] text-base font-semibold hover:bg-[#0a607d]"
              >
                Ingresar
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <CalculadoraFinanciamientoBNH />;
}

function CalculadoraFinanciamientoBNH() {
  const [category, setCategory] =
    useState("");

  const [basePrice, setBasePrice] =
    useState("");

  const [initialAmount, setInitialAmount] =
    useState("");

  const [ivaFinancing, setIvaFinancing] =
    useState<PaymentMode>("si");

  const [installments, setInstallments] =
    useState("");

  // Interruptor "Ajustar": solo afecta lo que se muestra en el panel de Contado
  const [ajustarIva, setAjustarIva] = useState(false);

  // --- Base de datos de equipos (Google Sheet vía Apps Script) ---
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [selectedEquipoId, setSelectedEquipoId] = useState("");
  const [equiposLoading, setEquiposLoading] = useState(false);
  const [equiposError, setEquiposError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEquipos() {
      setEquiposLoading(true);
      setEquiposError("");

      try {
        const data = await fetchEquipos();
        if (active) setEquipos(data);
      } catch (err) {
        if (active) {
          setEquiposError(
            err instanceof Error
              ? err.message
              : "No se pudo cargar la base de datos de equipos."
          );
        }
      } finally {
        if (active) setEquiposLoading(false);
      }
    }

    loadEquipos();

    return () => {
      active = false;
    };
  }, []);

  // --- Lista de vendedores (hoja VENDEDORES); si falla, se permite escribir el nombre ---
  const [vendedores, setVendedores] = useState<string[]>([]);
  const [vendedoresLoading, setVendedoresLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadVendedores() {
      setVendedoresLoading(true);

      try {
        const data = await fetchVendedores();
        if (active) setVendedores(data);
      } catch {
        if (active) setVendedores([]);
      } finally {
        if (active) setVendedoresLoading(false);
      }
    }

    loadVendedores();

    return () => {
      active = false;
    };
  }, []);

  const handleEquipoChange = (equipoId: string) => {
    setSelectedEquipoId(equipoId);

    const equipo = equipos.find((e) => e.id === equipoId);
    if (!equipo) return;

    const rawCategory = equipo.categoria.trim();
    const matchedKey = Object.entries(CATEGORIES).find(
      ([key, value]) =>
        key.toLowerCase() === rawCategory.toLowerCase() ||
        value.label.toLowerCase() === rawCategory.toLowerCase()
    )?.[0];

    if (matchedKey) {
      setCategory(matchedKey);
    }

    setBasePrice(formatNumberInput(equipo.precio));
  };

  // --- Datos del prospecto (lead) y vendedor, para la cotización ---
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [vendedorName, setVendedorName] = useState("");

  const [sendingQuote, setSendingQuote] = useState(false);
  const [sendQuoteError, setSendQuoteError] = useState("");
  const [sendQuoteSuccess, setSendQuoteSuccess] = useState("");

  const categoryConfig =
    category &&
    category in CATEGORIES
      ? CATEGORIES[
          category as keyof typeof CATEGORIES
        ]
      : null;

  const effectiveMinInitialRate =
    categoryConfig?.minInitialRate ??
    MIN_INITIAL_RATE;

  const numericBase = Number(basePrice);

  const numericInitial =
    Number(initialAmount);

  const numericInstallments =
    Number(installments);

  // Mínimo = el mayor entre el % de la categoría y $5.000
  const minInitialAmount =
    useMemo(() => {
      const safeBase =
        Number.isFinite(numericBase) &&
        numericBase > 0
          ? numericBase
          : 0;

      return Math.max(
        safeBase *
          effectiveMinInitialRate,
        MIN_INITIAL_AMOUNT
      );
    }, [
      numericBase,
      effectiveMinInitialRate,
    ]);

  // Inicial que se autocompleta: entera, múltiplo de $500 (5000, 5500, 6000...)
  const autoInitialAmount = useMemo(
    () => roundUpToMultiple(minInitialAmount, INITIAL_STEP),
    [minInitialAmount]
  );

  const suggestedInitialAmount =
    useMemo(() => {
      const safeBase =
        Number.isFinite(numericBase) &&
        numericBase > 0
          ? numericBase
          : 0;

      return Math.max(
        roundUpToMultiple(
          safeBase * SUGGESTED_INITIAL_RATE,
          INITIAL_STEP
        ),
        MIN_INITIAL_AMOUNT
      );
    }, [numericBase]);

  const vatAmount = useMemo(() => {
    const safeBase =
      Number.isFinite(numericBase) &&
      numericBase > 0
        ? numericBase
        : 0;

    return safeBase * VAT_RATE;
  }, [numericBase]);

  const contadoPrecio =
    Number.isFinite(numericBase) && numericBase > 0 ? numericBase : 0;

  const contadoIva = ajustarIva
    ? vatAmount * (1 - AJUSTE_IVA_DESCUENTO)
    : vatAmount;

  const contadoTotal = contadoPrecio + contadoIva;

  useEffect(() => {
    if (!categoryConfig) {
      setIvaFinancing("si");
      return;
    }

    if (
      !categoryConfig.canPayVATSeparately
    ) {
      setIvaFinancing("si");
    }
  }, [categoryConfig]);

  useEffect(() => {
    if (
      categoryConfig &&
      Number.isFinite(numericBase) &&
      numericBase > 0
    ) {
      setInitialAmount(
        String(autoInitialAmount)
      );
    } else if (!basePrice) {
      setInitialAmount("");
    }
  }, [
    categoryConfig,
    numericBase,
    autoInitialAmount,
    basePrice,
  ]);

  const validations = useMemo(() => {
    const errors: string[] = [];

    if (!categoryConfig)
      return errors;

    if (
      basePrice !== "" &&
      (!Number.isFinite(numericBase) ||
        numericBase <= 0)
    ) {
      errors.push(
        "No válido: la base imponible debe ser mayor a cero."
      );
    }

    if (
      initialAmount !== "" &&
      (!Number.isFinite(
        numericInitial
      ) ||
        numericInitial < 0)
    ) {
      errors.push(
        "No válido: el monto inicial debe ser un valor numérico válido."
      );
    }

    if (
      installments !== "" &&
      (!Number.isInteger(
        numericInstallments
      ) ||
        numericInstallments <= 0)
    ) {
      errors.push(
        "No válido: la cantidad de cuotas debe ser un entero mayor a cero."
      );
    }

    if (
      initialAmount !== "" &&
      Number.isFinite(numericInitial) &&
      numericInitial >= 0 &&
      !Number.isInteger(numericInitial)
    ) {
      errors.push(
        "No válido: la inicial debe ser un número entero (ej. 5000, 5500, 6000)."
      );
    }

    if (
      initialAmount !== "" &&
      Number.isFinite(numericInitial) &&
      numericInitial < MIN_INITIAL_AMOUNT
    ) {
      errors.push(
        `No válido: la inicial no puede ser menor a ${formatCurrency(
          MIN_INITIAL_AMOUNT
        )}. Por favor cambie el monto de la inicial.`
      );
    } else if (
      Number.isFinite(numericBase) &&
      numericBase > 0 &&
      Number.isFinite(numericInitial) &&
      numericInitial < minInitialAmount
    ) {
      errors.push(
        `No válido: la inicial debe ser al menos ${Math.round(
          effectiveMinInitialRate * 100
        )}% de la base imponible (${formatCurrency(
          minInitialAmount
        )}). Por favor cambie el monto.`
      );
    }

    if (
      Number.isFinite(numericBase) &&
      numericBase > 0 &&
      Number.isFinite(numericInitial) &&
      numericInitial >= numericBase
    ) {
      errors.push(
        "No válido: la inicial debe ser menor a la base imponible."
      );
    }

    if (
      installments !== "" &&
      Number.isInteger(
        numericInstallments
      ) &&
      numericInstallments >
        categoryConfig.maxInstallments
    ) {
      errors.push(
        "No válido: la cantidad de cuotas excede el máximo permitido."
      );
    }

    if (
      !categoryConfig.canPayVATSeparately &&
      ivaFinancing === "no"
    ) {
      errors.push(
        "No válido: esta categoría no permite pagar el I.V.A. por separado."
      );
    }

    return errors;
  }, [
    categoryConfig,
    basePrice,
    initialAmount,
    installments,
    ivaFinancing,
    numericBase,
    numericInitial,
    numericInstallments,
    minInitialAmount,
    effectiveMinInitialRate,
  ]);

  const calculations = useMemo(() => {
    const safeBase =
      Number.isFinite(numericBase) && numericBase > 0
        ? numericBase
        : 0;

    const safeInitial =
      Number.isFinite(numericInitial) && numericInitial >= 0
        ? numericInitial
        : 0;

    const safeInstallments =
      Number.isInteger(numericInstallments) &&
      numericInstallments > 0
        ? numericInstallments
        : 0;

    const safeVat = safeBase > 0 ? vatAmount : 0;

    const ivaSeparate =
      ivaFinancing === "no" ? safeVat : 0;

    const empty = {
      roundedMonthlyPayment: 0,
      totalToPay: safeInitial,
      ivaToPayField: ivaSeparate,
      financedAmount: 0,
      interestAmount: 0,
      financingFactor: 0,
    };

    if (
      !categoryConfig ||
      safeBase <= 0 ||
      safeInstallments <= 0
    ) {
      return empty;
    }

    // (BASE - INICIAL) = MONTO FINANCIADO
    const financedAmount = safeBase - safeInitial;

    if (financedAmount <= 0) return empty;

    // INTERÉS = MONTO FINANCIADO x FACTOR (20% < 18 cuotas | 25% >= 18 cuotas)
    const financingFactor = getFinancingFactor(safeInstallments);
    const interestAmount = financedAmount * financingFactor;

    // Si el I.V.A. se financia, se reparte en las cuotas (sin interés adicional)
    const ivaFinanced = ivaFinancing === "si" ? safeVat : 0;

    const rawMonthlyPayment =
      (financedAmount + interestAmount + ivaFinanced) /
      safeInstallments;

    const roundedMonthlyPayment =
      roundUpToNearest5(rawMonthlyPayment);

    const totalToPay =
      safeInitial +
      ivaSeparate +
      roundedMonthlyPayment * safeInstallments;

    return {
      roundedMonthlyPayment,
      totalToPay,
      ivaToPayField: ivaSeparate,
      financedAmount,
      interestAmount,
      financingFactor,
    };
  }, [
    numericBase,
    numericInitial,
    numericInstallments,
    vatAmount,
    ivaFinancing,
    categoryConfig,
  ]);

  const isValid =
    !!categoryConfig &&
    Number.isFinite(numericBase) &&
    numericBase > 0 &&
    Number.isFinite(
      numericInitial
    ) &&
    numericInitial >=
      minInitialAmount &&
    Number.isInteger(
      numericInstallments
    ) &&
    numericInstallments > 0 &&
    numericInstallments <=
      categoryConfig.maxInstallments &&
    validations.length === 0 &&
    Number.isInteger(numericInitial) &&
    numericInitial >= MIN_INITIAL_AMOUNT &&
    calculations.roundedMonthlyPayment >
      0;

  const handleReset = () => {
    setCategory("");
    setBasePrice("");
    setInitialAmount("");
    setIvaFinancing("si");
    setInstallments("");
    setAjustarIva(false);
    setSelectedEquipoId("");
    setSendQuoteError("");
    setSendQuoteSuccess("");
  };

  const handleSendQuote = async () => {
    setSendQuoteError("");
    setSendQuoteSuccess("");

    if (!isValid) {
      setSendQuoteError(
        "Complete correctamente los datos de la operación antes de enviar la cotización."
      );
      return;
    }

    if (!leadName.trim() || !leadEmail.trim() || !vendedorName.trim()) {
      setSendQuoteError(
        "Complete el nombre del lead, su email y el vendedor antes de enviar."
      );
      return;
    }

    setSendingQuote(true);

    try {
      const equipoSeleccionado = equipos.find(
        (e) => e.id === selectedEquipoId
      );

      const result = await saveQuoteAndSendEmail({
        leadName: leadName.trim(),
        leadPhone: leadPhone.trim(),
        leadEmail: leadEmail.trim(),
        vendedorName: vendedorName.trim(),
        equipo: equipoSeleccionado?.nombre ?? "",
        categoria: categoryConfig?.label ?? "",
        basePrice: numericBase,
        initialAmount: numericInitial,
        installments: numericInstallments,
        monthlyPayment: calculations.roundedMonthlyPayment,
        totalToPay: calculations.totalToPay,
        ivaFinancing,
        ivaToPay: calculations.ivaToPayField,
        contadoPrecio,
        contadoIva,
        contadoTotal,
        contadoAjustePct: ajustarIva
          ? Math.round(AJUSTE_IVA_DESCUENTO * 100)
          : 0,
        logoUrl: `${window.location.origin}/logo-bnh.jpeg`,
      });

      const numeroTxt = result.numero
        ? ` (N° ${result.numero})`
        : "";

      setSendQuoteSuccess(
        result.warning
          ? `Cotización${numeroTxt} guardada y enviada al lead con el PDF adjunto. ${result.warning}`
          : `Cotización${numeroTxt} guardada en el Funel de Venta y enviada por correo con el PDF adjunto.`
      );
    } catch (err) {
      setSendQuoteError(
        err instanceof Error
          ? err.message
          : "No se pudo enviar la cotización. Intente nuevamente."
      );
    } finally {
      setSendingQuote(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#f3f5f7] px-4 py-6 md:px-6 md:py-8"
      style={{
        fontFamily:
          "Verdana, sans-serif",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 bg-transparent md:mb-8">
          <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-center md:text-left">
            <div className="rounded-3xl bg-white px-6 py-4 shadow-sm ring-1 ring-gray-200">
              <Image
                src="/logo-bnh.jpeg"
                alt="BNH Medical"
                width={240}
                height={120}
                className="h-auto w-[190px] md:w-[220px]"
                priority
              />
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Calculadora de
                Financiamiento
              </h1>

              <p className="mt-2 text-sm text-gray-600 md:text-base">
                Simulación comercial
                para planes de
                financiamiento
              </p>

              <div className="mt-4 inline-flex rounded-full bg-[#0d6f91]/10 px-4 py-2 text-sm font-medium text-[#0d6f91]">
                BNH Medical ·
                Herramienta interna
              </div>
            </div>
          </div>
        </div>

        <Card className="mb-6 rounded-3xl border-0 shadow-sm ring-1 ring-gray-200 md:mb-8">
          <CardHeader>
            <CardTitle className="text-2xl text-gray-900">
              Datos del prospecto y vendedor
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="mb-2 block">
                  Nombre del lead
                </Label>

                <Input
                  type="text"
                  value={leadName}
                  onChange={(e) =>
                    setLeadName(e.target.value)
                  }
                  placeholder="Ej. Dr. Juan Rodríguez"
                  className="rounded-xl"
                />
              </div>

              <div>
                <Label className="mb-2 block">
                  Teléfono
                </Label>

                <Input
                  type="tel"
                  value={leadPhone}
                  onChange={(e) =>
                    setLeadPhone(e.target.value)
                  }
                  placeholder="Ej. 0414-1234567"
                  className="rounded-xl"
                />
              </div>

              <div>
                <Label className="mb-2 block">
                  Email
                </Label>

                <Input
                  type="email"
                  value={leadEmail}
                  onChange={(e) =>
                    setLeadEmail(e.target.value)
                  }
                  placeholder="Ej. doctor@clinica.com"
                  className="rounded-xl"
                />
              </div>

              <div>
                <Label className="mb-2 block">
                  Vendedor
                </Label>

                {vendedores.length > 0 ? (
                  <Select
                    value={vendedorName}
                    onValueChange={setVendedorName}
                  >
                    <SelectTrigger
                      className="rounded-xl"
                      style={{
                        fontFamily: "Verdana, sans-serif",
                      }}
                    >
                      <SelectValue placeholder="Seleccione un vendedor" />
                    </SelectTrigger>

                    <SelectContent
                      style={{
                        fontFamily: "Verdana, sans-serif",
                      }}
                    >
                      {vendedores.map((nombre) => (
                        <SelectItem
                          key={nombre}
                          value={nombre}
                          style={{
                            fontFamily: "Verdana, sans-serif",
                          }}
                        >
                          {nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="text"
                    value={vendedorName}
                    onChange={(e) =>
                      setVendedorName(e.target.value)
                    }
                    placeholder={
                      vendedoresLoading
                        ? "Cargando vendedores..."
                        : "Ej. María Pérez"
                    }
                    className="rounded-xl"
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-3xl border-0 shadow-sm ring-1 ring-gray-200">
            <CardHeader>
              <CardTitle className="text-2xl text-gray-900">
                Datos de la operación
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-5">
              <div>
                <Label className="mb-2 block">
                  Equipo
                </Label>

                <Select
                  value={selectedEquipoId}
                  onValueChange={handleEquipoChange}
                  disabled={equiposLoading || equipos.length === 0}
                >
                  <SelectTrigger
                    className="rounded-xl"
                    style={{
                      fontFamily: "Verdana, sans-serif",
                    }}
                  >
                    <SelectValue
                      placeholder={
                        equiposLoading
                          ? "Cargando equipos..."
                          : "Seleccione un equipo (opcional)"
                      }
                    />
                  </SelectTrigger>

                  <SelectContent
                    style={{
                      fontFamily: "Verdana, sans-serif",
                    }}
                  >
                    {equipos.map((equipo) => (
                      <SelectItem
                        key={equipo.id}
                        value={equipo.id}
                        style={{
                          fontFamily: "Verdana, sans-serif",
                        }}
                      >
                        {equipo.nombre} —{" "}
                        {formatCurrency(equipo.precio)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {equiposError ? (
                  <p className="mt-2 text-xs text-red-600">
                    {equiposError}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">
                    Al seleccionar un equipo se completan
                    automáticamente la categoría y la base
                    imponible; puede ajustarlos manualmente.
                  </p>
                )}
              </div>

              <div>
                <Label className="mb-2 block">
                  Categoría
                </Label>

                <Select
                  value={category}
                  onValueChange={
                    setCategory
                  }
                >
                  <SelectTrigger
                    className="rounded-xl"
                    style={{
                      fontFamily:
                        "Verdana, sans-serif",
                    }}
                  >
                    <SelectValue placeholder="Seleccione una categoría" />
                  </SelectTrigger>

                  <SelectContent
                    style={{
                      fontFamily:
                        "Verdana, sans-serif",
                    }}
                  >
                    {Object.entries(
                      CATEGORIES
                    ).map(
                      ([
                        key,
                        value,
                      ]) => (
                        <SelectItem
                          key={key}
                          value={key}
                          style={{
                            fontFamily:
                              "Verdana, sans-serif",
                          }}
                        >
                          {
                            value.label
                          }
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 block">
                  Base imponible
                </Label>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={basePrice}
                  onChange={(e) =>
                    setBasePrice(
                      e.target.value
                    )
                  }
                  placeholder="Ej. 10000"
                  className="rounded-xl"
                />
              </div>

              <div>
                <Label className="mb-2 block">
                  Monto inicial
                </Label>

                <Input
                  type="number"
                  min={MIN_INITIAL_AMOUNT}
                  step={INITIAL_STEP}
                  value={initialAmount}
                  onChange={(e) =>
                    setInitialAmount(
                      e.target.value
                    )
                  }
                  placeholder="Ej. 5000"
                  className="rounded-xl"
                />

                <p className="mt-2 text-xs text-gray-500">
                  Inicial mínima 
                </p>

                {categoryConfig?.hasCommissionNote ? (
                  <div className="mt-2 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-gray-700">
                    <p>
                      a. Inicial mínima
                      20%:{" "}
                      <span className="font-semibold">
                        {formatCurrency(
                          (Number.isFinite(
                            numericBase
                          ) &&
                          numericBase >
                            0
                            ? numericBase
                            : 0) *
                            0.2
                        )}
                      </span>
                    </p>
                    <p>
                      b. Inicial
                      sugerida 25%:{" "}
                      <span className="font-semibold">
                        {formatCurrency(
                          suggestedInitialAmount
                        )}
                      </span>
                    </p>
                    <p>
                      
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">
                   
                  </p>
                )}
              </div>

              <div>
                <Label className="mb-2 block">
                  Financiamiento del
                  I.V.A.
                </Label>

                <Select
                  value={ivaFinancing}
                  onValueChange={(
                    value: PaymentMode
                  ) =>
                    setIvaFinancing(
                      value
                    )
                  }
                >
                  <SelectTrigger
                    className="rounded-xl"
                    style={{
                      fontFamily:
                        "Verdana, sans-serif",
                    }}
                  >
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>

                  <SelectContent
                    style={{
                      fontFamily:
                        "Verdana, sans-serif",
                    }}
                  >
                    <SelectItem
                      value="si"
                      style={{
                        fontFamily:
                          "Verdana, sans-serif",
                      }}
                    >
                      Sí
                    </SelectItem>

                    {categoryConfig?.canPayVATSeparately ? (
                      <SelectItem
                        value="no"
                        style={{
                          fontFamily:
                            "Verdana, sans-serif",
                        }}
                      >
                        No
                      </SelectItem>
                    ) : (
                      <SelectItem
                        value="no"
                        disabled
                        style={{
                          fontFamily:
                            "Verdana, sans-serif",
                        }}
                      >
                        No
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 block">
                  Cantidad de cuotas
                </Label>

                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={installments}
                  onChange={(e) =>
                    setInstallments(
                      e.target.value
                    )
                  }
                  placeholder="Ej. 12"
                  className="rounded-xl"
                />

                <p className="mt-2 text-xs text-gray-500">
                  {categoryConfig
                    ? `Máximo permitido: ${categoryConfig.maxInstallments} cuotas`
                    : "Seleccione una categoría para ver el máximo permitido"}
                </p>
              </div>

              {validations.length >
                0 && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertDescription>
                    <div className="space-y-1">
                      {validations.map(
                        (
                          message,
                          index
                        ) => (
                          <div
                            key={
                              index
                            }
                          >
                            {
                              message
                            }
                          </div>
                        )
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <Button
                variant="outline"
                onClick={
                  handleReset
                }
                className="rounded-xl border-gray-300"
              >
                Restablecer
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-0 shadow-sm ring-1 ring-gray-200">
            <CardHeader>
              <CardTitle className="text-2xl text-gray-900">
                Resultados
              </CardTitle>
            </CardHeader>

            <CardContent>
              {/* ===== CONTADO ===== */}
              <div className="mb-6 rounded-3xl border border-gray-200 bg-gray-50 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-xl font-bold text-gray-900">
                    De contado
                  </h3>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={ajustarIva}
                    onClick={() => setAjustarIva((v) => !v)}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-700"
                  >
                    <span>Ajustar</span>
                    <span
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        ajustarIva ? "bg-[#0d6f91]" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          ajustarIva ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                  <Item
                    label="Precio del equipo"
                    value={formatCurrency(contadoPrecio)}
                  />

                  <Item
                    label={
                      ajustarIva
                        ? `I.V.A. (ajuste -${Math.round(
                            AJUSTE_IVA_DESCUENTO * 100
                          )}%)`
                        : "I.V.A."
                    }
                    value={formatCurrency(contadoIva)}
                  />

                  <Item
                    label="Total"
                    value={formatCurrency(contadoTotal)}
                  />
                </div>
              </div>

              {/* ===== CRÉDITO ===== */}
              <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
              <h3 className="mb-4 text-xl font-bold text-gray-900">
                Crédito
              </h3>

              <div className="mb-4 rounded-3xl bg-[#0b0b0b] p-8 text-white shadow-lg">
                <p className="text-base font-medium text-gray-300">
                  Cuota mensual
                </p>

                <p className="mt-3 text-5xl font-extrabold tracking-tight md:text-6xl">
                  {isValid
                    ? formatCurrency(
                        calculations.roundedMonthlyPayment
                      )
                    : "$0.00"}
                </p>

                <p className="mt-4 text-sm font-medium text-gray-300">
                  Total de pagos:{" "}
                  <span className="font-bold text-white">
                    {isValid
                      ? numericInstallments
                      : 0}
                  </span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <Item
                  label="Cantidad de cuotas"
                  value={String(
                    isValid
                      ? numericInstallments
                      : 0
                  )}
                />

                <Item
                  label="Monto de inicial"
                  value={formatCurrency(
                    numericInitial ||
                      0
                  )}
                />

                <Item
                  label="Monto financiado"
                  value={formatCurrency(
                    isValid ? calculations.financedAmount : 0
                  )}
                />

                <Item
                  label={`Interés de financiamiento (${Math.round(
                    calculations.financingFactor * 100
                  )}%)`}
                  value={formatCurrency(
                    isValid ? calculations.interestAmount : 0
                  )}
                />

                <Item
                  label="I.V.A. a pagar en Bs"
                  value={formatCurrency(
                    calculations.ivaToPayField
                  )}
                />

                <Item
                  label="Total a pagar"
                  value={formatCurrency(
                    calculations.totalToPay
                  )}
                />
              </div>
              </div>

              <Button
                onClick={handleSendQuote}
                disabled={sendingQuote}
                className="mt-6 h-12 w-full rounded-xl bg-[#0d6f91] text-base font-semibold hover:bg-[#0a607d]"
              >
                {sendingQuote ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 size-4" />
                    Enviar cotización por correo
                  </>
                )}
              </Button>

              <p className="mt-2 text-xs text-gray-500">
                Se generará el PDF de la cotización y se
                enviará por correo al lead (y al vendedor, si
                su correo está registrado en la hoja
                &quot;VENDEDORES&quot;); quedará guardada en
                el Funel de Venta.
              </p>

              {sendQuoteError && (
                <Alert className="mt-4 border-red-200 bg-red-50">
                  <AlertDescription>
                    {sendQuoteError}
                  </AlertDescription>
                </Alert>
              )}

              {sendQuoteSuccess && (
                <Alert className="mt-4 border-green-200 bg-green-50">
                  <AlertDescription>
                    {sendQuoteSuccess}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-gray-500">
        {label}
      </p>

      <p className="mt-1 font-semibold text-gray-900">
        {value}
      </p>
    </div>
  );
}

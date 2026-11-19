# Guía técnica de EDL / 9008 en plataformas Qualcomm Snapdragon

**Documento de referencia para la app de reparación — versión 1.0**
**Fecha de compilación:** 31 de octubre de 2026
**Ámbito:** MSM / SDM / SM (Snapdragon), protocolos Sahara y Firehose, VID `0x05C6` PID `0x9008`
**Idioma:** español

---

## 0. Cómo leer este documento

Este informe está pensado para integrarse como documentación interna de una herramienta de escritorio de reparación. Se estructura en tres capas:

| Capa | Secciones | Uso |
|---|---|---|
| **Conceptual** | 1, 6, 10 | Formación del técnico, criterios de decisión |
| **Operativa** | 2, 3, 4, 5, 7 | Procedimientos ejecutables paso a paso |
| **Diagnóstico** | 8, 9 | Resolución de fallos y búsqueda de información |

**Convenciones:**

- ✅ **Hecho verificado**: contrastado en al menos una fuente primaria (código fuente, documentación de protocolo, ficha de Qualcomm) o reproducible.
- ⚠️ **Opinión / práctica de taller**: consenso de comunidad, no normativo. Se marca explícitamente.
- 🔴 **Punto de no retorno**: acción que puede dejar el equipo irrecuperable por software.
- Todos los comandos se dan para **Windows** salvo indicación contraria; las variantes Linux/macOS se anotan cuando difieren.

> **Aviso previo:** EDL no es magia. En 2026 la entrada en 9008 sigue siendo casi universal, pero **la capacidad de escribir** ya no lo es: los programadores Firehose van firmados por el OEM y el PBL rechaza los no firmados en la mayoría de equipos de gama media/alta desde ~2018. "Entrar en EDL" y "poder flashear" son dos cosas distintas.

---

## 1. Qué es EDL / 9008, en qué chips aplica y qué se puede y no se puede hacer

### 1.1 Definición técnica

EDL (*Emergency Download Mode*), identificado por Windows como **Qualcomm HS-USB QDLoader 9008**, es una función implementada **en la Boot ROM (PBL) del SoC**. Al estar en ROM grabada en silicio, **no se puede corromper por software**: es el último recurso del chip cuando la cadena de arranque en almacenamiento está rota.

✅ La descripción canónica del mecanismo, citada por Aleph Research (divulgación 22-ene-2018, advisory `ALEPH-2017028` / QPSIIR-909):

> "In this mode, the device identifies itself as Qualcomm HS-USB 9008 through USB. EDL is implemented by the PBL. Since the PBL is a ROM resident, EDL cannot be corrupted by software. The EDL mode itself implements the Qualcomm Sahara protocol, which accepts an OEM-digitally-signed programmer (an ELF binary in recent devices, MBN in older ones) over USB, that acts as an SBL. Modern such programmers implement the Firehose protocol."
> — <https://alephsecurity.com/vulns/aleph-2017028>

Cadena real:

```
[PBL en ROM] --(EDL, USB 05C6:9008)--> [Programador Firehose en SRAM] --(XML sobre USB)--> [eMMC/UFS]
```

El programador se ejecuta **en la SRAM interna del SoC**, no en el almacenamiento. Por eso puede escribir sectores crudos aunque el almacenamiento esté sin tabla de particiones.

### 1.2 Identificadores USB que hay que distinguir

| VID:PID | Nombre en Windows | Significado | ¿Sirve para flashear? |
|---|---|---|---|
| `05C6:9008` | Qualcomm HS-USB QDLoader 9008 | **EDL real**, Sahara escuchando | ✅ Sí |
| `05C6:900E` | Qualcomm HS-USB Diagnostics 900E | Modo *crash dump* / diagnóstico | ⚠️ Parcial: `edl memorydump`, no flasheo normal |
| `05C6:9006` | Qualcomm Memory Debug | Volcado de memoria | ❌ Solo lectura de RAM |
| `05C6:9091`, `05C6:901D` | Variantes QDLoader | Algunos SoC nuevos usan PID alternativo | ✅ Sí (qdl ignora el PID) |
| `05C6:F000` | — | Estado intermedio (p. ej. ASUS Zenfone 8 con combo de teclas) | ❌ No es EDL; hay que añadir regla udev o usar cable |

✅ `qdl` documenta explícitamente que **no filtra por PID**, solo por VID `05c6`, porque "new devices keep appearing with new IDs" (<https://github.com/linux-msm/qdl>).

✅ El modo 900E aparece cuando el *grounding* del pin de arranque es incorrecto o el equipo cae en diagnóstico: hay que desconectar, rehacer el corto con firmeza y reconectar sin batería (<https://romwala.com/blog/qualcomm-edl-mode-9008-test-points-boot-guide>, 10-oct-2026).

### 1.3 Familias de chips afectadas

| Familia | Ejemplos | Almacenamiento típico | Notas EDL |
|---|---|---|---|
| **MSM** (legacy) | MSM8916/8917/8937/8953/8974/8994/8996 | eMMC / NAND | Programadores de 32 bits, muchos **sin firma**. `edl` funciona casi siempre. |
| **SDM** | SDM630/636/660/670/710/845 | eMMC / UFS | Punto de inflexión: desde ~2018 el PBL exige **firma del programador**. |
| **SM** (moderno) | SM6115, SM6225, SM7125, SM7325, **SM7550**, SM8350, SM8450, SM8550, SM8650, SM8750 | UFS | Sahara v3 (sin lectura de HWID/PKHASH por comandos 0x02/0x03), auth obligatoria, ARB por fusible. |
| **MDM / SDX** (módems) | MDM9x07, SDX55, SDX72 | NAND / eMMC | Modo *streaming* 0x900E; requieren `--loader` explícito y a veces `AT!BOOTHOLD`. |

✅ El README de `bkerler/edl` lista explícitamente "Secure loader with SDM660 on Xiaomi not yet supported (EDL authentification)" y documenta el flujo de módems Sierra/Netgear/ZTE con `AT!BOOTHOLD`, `AT+ZCDRUN=E` y `qc_diag -sahara`.

✅ Sahara v3 rompió la autodetección: los comandos `0x03` (OEM_PK_HASH_READ) y `0x02` (MSM_HW_ID_READ) ya no responden; el fork actual usa `0x0A` (CHIP_ID_V3_READ) con la estructura de 46 bytes descrita en el README (offsets 36-39 MSM_ID, 40-41 OEM_ID, 42-43 MODEL_ID).

### 1.4 Qué SÍ se puede hacer

- Leer y escribir **cualquier sector** del almacenamiento (GPT, bootloaders, `super`, `persist`, `modem`…).
- **Reconstruir la tabla GPT** (`gpt` / `fixgpt`) en equipos con GPT corrupta.
- **Dumpear** el contenido íntegro antes de tocar nada (backup forense).
- **Borrar** particiones (`e`), incluida `misc` para forzar modos de arranque.
- **Leer/escribir memoria** del SoC con `peek`/`poke` (solo en programadores que lo soportan, normalmente los de nivel EL3).
- Volcar **fuses qfprom** (`qfp`) y el **PBL** (`pbl`) en programadores EL3.
- Ejecutar `modules oemunlock enable` para activar el flag OEM cuando existe la partición `config`.
- Recuperar equipos con pantalla muerta, fastboot inaccesible o Android que no arranca.

### 1.5 Qué NO se puede hacer (o no siempre)

| Limitación | Detalle | Fuente |
|---|---|---|
| 🔴 **Cargar un programador no firmado** | El PBL verifica la firma RSA del programador contra la clave del OEM. Un `.elf` genérico se rechaza con `Only nop and sig tag can be recevied before authentication`. | `bkerler/edl` issue #464; `edl-noauth-kit` |
| 🔴 **Saltarse la autenticación Firehose** | Requiere `sig TargetName="req"` → challenge → `sig TargetName="sig"` + firma RSA-2048 PKCS#1 v1.5. Solo hay bypass en programadores antiguos con buffer de challenge a cero (blob `blob2`). | `edl-noauth-kit` README |
| ❌ **Desbloquear el bootloader por sí solo** | EDL escribe el flag en `devinfo`, pero el desbloqueo real lo consuma `fastboot oem unlock <code>` con el código del OEM. | Práctica de taller ⚠️ |
| ❌ **Saltar ARB / anti-rollback** | Si el fusible qfprom ya está soplado, un `xbl`/`abl` de versión inferior se rechaza o deja el equipo muerto. | XDA 4775930 (ene-2026) |
| ❌ **Reparar hardware** | Si el PBL no enumera (sin `05C6:9008`), EDL no existe: es problema de PMIC, VBUS, flex o BGA. | romwala (10-oct-2026) |
| ❌ **Evitar la pérdida de datos** | Un flasheo completo escribe `userdata`. | isptestpoint (16-jul-2026) |
| ⚠️ **Funcionar en todos los equipos** | Algunos OEM desactivan la ruta del cable EDL por resistencia y exigen test point. | bitandboot Systems Lab |

> ⚠️ **Opinión de taller:** el error más caro no es "no poder flashear", es **flashear con el programador de otro modelo**. Un Firehose de una *stepping* distinta puede aceptar comandos que interpreta mal y corromper el almacenamiento de forma que el brick original no había producido (bitandboot, 2026).

---

## 2. Cómo ENTRAR en modo EDL

### 2.1 Jerarquía de métodos (de menos a más invasivo)

| Nivel | Método | Requisito | Éxito |
|---|---|---|---|
| 1 | `adb reboot edl` | Android arrancado + depuración USB | Alto en MSM/SDM; **nulo** en muchos kernels modernos |
| 2 | `fastboot oem edl` | Fastboot accesible | Depende del `abl`; muchos OEM lo capan |
| 3 | `fastboot reboot-edl` | Fastboot accesible | Igual que arriba |
| 4 | `setprop sys.powerctl reboot,edl` | Root o `adb shell` con permisos | Medio |
| 5 | Combo de teclas al conectar USB | Hardware | Variable por OEM |
| 6 | Cable EDL / *deep flash* | Cable modificado | Solo chips antiguos (625/660/820) |
| 7 | **Test point** | Abrir el equipo, pinza | **Universal** (si el PBL vive) |

✅ Los cinco primeros están listados literalmente en la documentación de la utilidad `edl.exe` de temblast (<https://www.temblast.com/edl.htm>, actualizada 28-oct-2026).

### 2.2 Comandos exactos

```bash
# Nivel 1 — desde Android con depuración USB activa
adb devices
adb reboot edl

# Nivel 2 — desde fastboot
fastboot devices
fastboot oem edl
# variante
fastboot reboot-edl

# Nivel 4 — desde shell
adb shell setprop sys.powerctl reboot,edl
```

**Verificación obligatoria** (Windows):

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like "*VID_05C6*" } |
  Select-Object Status, Class, FriendlyName, InstanceId
```

Debe aparecer `Qualcomm HS-USB QDLoader 9008 (COMx)` **sin** signo de exclamación. Si aparece `QHUSB_BULK` con triángulo amarillo, falta el driver (ver §5).

En Linux:

```bash
lsusb | grep -i 05c6
# Bus 003 Device 037: ID 05c6:9008 Qualcomm, Inc. Gobi Wireless Modem (QDL mode)
```

✅ El combo de teclas **no es universal y muchos OEM lo han desactivado**. En el ASUS Zenfone 8, `adb reboot edl` falla con LineageOS/StatiXOS y el combo Vol+ + Vol− solo lleva a `05C6:F000`, que no es EDL: la única vía es el cable especial (XDA 4672703, may-2024).

### 2.3 Entrada por familia / OEM

| OEM | Método habitual | Auth Firehose | Notas |
|---|---|---|---|
| **Xiaomi / Redmi / POCO** | `adb reboot edl`, `fastboot oem edl`, **test point** | 🔴 **Sí** (cuenta autorizada o bypass) | Test point obligatorio en brick duro; auth desde 2018 |
| **Samsung** | **Test point** casi siempre | 🔴 Sí (programadores por modelo) | Chimera documenta test points para Samsung y Xiaomi |
| **Motorola / Lenovo** | `fastboot oem edl`, combo Vol± al conectar, **blankflash** | ⚠️ Variable | `blankflash` es un paquete EDL propio del modelo |
| **OnePlus / OPPO / realme** | Combo Vol+ + Vol− al conectar USB | 🔴 Sí | MSM Download Tool / Oppo Flash Tool por modelo |
| **vivo / iQOO** | Combo de volumen | 🔴 Sí | Chimera ofrece auth para vivo |
| **Huawei / Honor** | Test point | 🔴 Sí | Herramientas de terceros |
| **LG** | `fastboot oem edl` en modelos antiguos | ⚠️ Variable | — |
| **Google Pixel** | `adb reboot edl` (con desbloqueo) | 🔴 Sí | EDL visible por accidente en Pixel 3 (Wikipedia) |
| **ZTE** | Comando / test point | ⚠️ Variable | Chimera soporta ZTE en EDL |

✅ ChimeraTool, doc oficial (creada 18-jul-2024, modificada **31-oct-2026**): "En la mayoría de dispositivos Samsung y Xiaomi se deben usar testpoints. En la mayoría de dispositivos Motorola, Oppo y Vivo puedes iniciar en modo EDL usando combinaciones de botones" (<https://chimeratool.com/docs/qualcomm-edl-mode>).

### 2.4 Test point: procedimiento

🔴 **Requiere abrir el equipo. Anula sellos de garantía en la mayoría de marcas.**

1. Equipo apagado y **desconectada la flex de batería** (elimina riesgo de corto sobre el PMIC).
2. Retirar blindajes; localizar los dos pads dorados (junto al escudo del SoC/UFS o al flex de volumen).
3. Puentear con pinza de punta fina **sin apoyar peso** sobre la placa.
4. Con el puente hecho, conectar el USB.
5. Mantener 2–3 s hasta el *chime* de Windows; retirar la pinza.
6. Verificar `QDLoader 9008 (COMx)`.

✅ Secuencia descrita en XDA 4568025 (23-mar-2023) y romwala (10-oct-2026). En el POCO F4 GT hay que reconectar la flex de batería en 10–15 s o el equipo sale de 9008.

**Diagnóstico rápido por estado del Administrador de dispositivos** (romwala, 10-oct-2026):

| Estado | Causa | Acción |
|---|---|---|
| `Diagnostics 900E` | Grounding deficiente | Desconectar, rehacer corto, reconectar sin batería |
| `QHSUSB_BULK` con amarillo | Driver ausente o sin firma | Desactivar firma de drivers, instalar `qcser.inf` |
| *Chimes* repetidos | Batería conectada con tensión baja / pinza sucia | Desconectar flex de batería, limpiar puntas |
| Nada detectado | Sub-board de carga, flex o BGA del SoC | Continuidad de flex, comprobar VBUS 5 V |

### 2.5 Cable EDL / Deep Flash

✅ El cable lleva una **resistencia entre D+ y GND**; al pulsar el botón durante la conexión fuerza el fallback del PBL (Wikipedia, *Qualcomm EDL mode*, §"EDL Deep Flash Cable").

⚠️ **Solo fiable en chips antiguos** (Snapdragon 625/660/820). Los SoC de las series 700 y 800/8 Gen tienen fusibles que desactivan la detección por resistencia (romwala, 10-oct-2026; bitandboot, 2026).

### 2.6 Modelos que exigen autorización

🔴 **Regla práctica:** si el equipo es de 2018 o posterior y es Xiaomi, OPPO, vivo, Samsung, OnePlus o Huawei, **asume que necesitarás autenticación**. Opciones:

1. **Cuenta autorizada** del OEM (Xiaomi exige cuenta con permisos; se revende el servicio).
2. **Herramienta comercial** con auth integrada (Chimera, UnlockTool, TFT, Qualcomm Premium Tool).
3. **Bypass `blob2`** — solo en programadores antiguos con challenge a cero. Condición crítica: **reconectar/encender de nuevo antes de cada sesión**; si cualquier herramienta envía antes un `req`, el challenge se genera y el bypass muere (edl-noauth-kit).

✅ Estructura del handshake de auth (edl-noauth-kit): RSA-2048 con verificación PKCS#1 v1.5; el payload debe coincidir con un challenge aleatorio que **solo se genera tras `<sig TargetName="req">`**.

---

## 3. Cómo SALIR de EDL

### 3.1 Métodos ordenados por suavidad

| # | Método | Comando / acción | Notas |
|---|---|---|---|
| 1 | Reset por protocolo | `edl reset` | Envía `power reset` por Firehose |
| 2 | Reset por Sahara | `qdl reset` | No necesita programador |
| 3 | Reset desde la utilidad temblast | `edl.exe /z` | `/zo` apaga, `/ze` vuelve a EDL, `/zf` a fastboot (solo Motorola) |
| 4 | Pulsación larga | Power 10–20 s | Funciona sin PC |
| 5 | Desconectar batería | Abrir equipo | Último recurso físico |
| 6 | `fastboot reboot` | Solo si ya estás en **fastboot**, no en EDL | — |

```bash
# Salida limpia
edl reset
# o, si el programador ya está cargado y quieres apagar
edl rawxml "<?xml version=\"1.0\" encoding=\"UTF-8\" ?><data><power value=\"off\"/></data>"
```

✅ `edl reset` puede imprimir `USBError(19, 'No such device')`: **es normal**, el equipo se ha ido antes de responder (XDA 4672703).

### 3.2 Si se queda clavado en 9008

1. **No flashees a ciegas.** Primero `edl printgpt` para confirmar que el enlace responde.
2. Desconecta el USB, espera 10 s, reconecta. Muchos equipos salen solos al no recibir handshake.
3. `edl reset` sin `--loader` (usa Sahara puro).
4. Power 20 s con el cable desconectado.
5. Desconecta la flex de batería 30 s y reconecta.
6. Si tras eso sigue en 9008: **el PBL está en bucle porque no encuentra arranque válido**. No es un fallo de EDL, es que el almacenamiento no tiene cadena de arranque: hay que **flashear**, no "salir".
7. Si aparece 900E en lugar de 9008: rehacer el corto (ver §2.4).

⚠️ Un equipo que entra en 9008 solo (sin comando) tras un flasheo fallido está en *fallback*: el PBL no valida `xbl`. Ahí el objetivo no es salir, es restaurar `xbl`/`xbl_config`/`abl` de la **misma versión**.

---

## 4. Herramientas reales

### 4.1 Comparativa

| Herramienta | Tipo | Plataforma | Coste | Estado (oct-2026) | Enlace |
|---|---|---|---|---|---|
| **bkerler/edl** (`edl.py`) | CLI Python, open source | Win/Linux/macOS | Gratis (GPLv3) | **Activo**: 660 commits, 2.7k ★, soporte Sahara v3 añadido | <https://github.com/bkerler/edl> |
| **linux-msm/qdl** | CLI C, open source | Linux/macOS/WSL2 | Gratis (BSD-3) | **Activo**: 615 commits, VIP, `--dry-run`, `qdl reset` | <https://github.com/linux-msm/qdl> |
| **temblast edl.exe** | CLI Win32 | Windows | Gratis | **Activo**: actualizado 28-oct-2026 | <https://www.temblast.com/edl.htm> |
| **QPST / QFIL** | GUI oficial Qualcomm | Windows | Gratis (no redistribuible) | Estable, sin desarrollo público | — |
| **MSM Download Tool** | GUI por modelo (OnePlus/OPPO) | Windows | Gratis | Solo modelos antiguos (≤ OnePlus 9) | — |
| **Qualcomm Premium Tool** | GUI comercial | Windows | Pago | Activo | — |
| **UnlockTool** | GUI comercial multi-marca | Windows | Suscripción | Activo, 3.500+ modelos | <https://www.unlocktool.org/supported-models> |
| **Chimera Tool** | GUI comercial | Windows | Suscripción | **Muy activo**: +2.000 modelos en Q3-2026 | <https://chimeratool.com> |
| **TFT (InfinityBox)** | GUI comercial | Windows | Pago | Activo | — |
| **QDLoader HS-USB Driver** | Driver | Windows | Gratis | Necesario para QFIL | — |
| **edl-noauth-kit** | Parche sobre `edl` | macOS | Gratis | Activo, específico SDM660 | <https://github.com/HsOjo/edl-noauth-kit> |

### 4.2 Instalación de `edl.py` (Windows)

```powershell
# Método automático (PowerShell, Win10+)
curl.exe -O https://raw.githubusercontent.com/bkerler/edl/master/install_edl_win10_win11.ps1
.\install_edl_win10_win11.ps1
```

Manual: Python ≥3.10 + git, driver 9008 instalado, **UsbDk** desde <https://github.com/daynix/UsbDk/releases/>. Verificación: `UsbDkController -n` debe listar el PID `0x9008`.

```bash
git clone https://github.com/bkerler/edl
cd edl
git submodule update --init --recursive   # trae Loaders/
pip3 install -r requirements.txt
```

✅ El README advierte: **no** usar `--recurse-submodules` en el clonado; hay que hacer `git submodule update` después.

### 4.3 Comandos de `edl.py` (referencia completa)

**Generales**

```bash
edl -h                                   # ayuda
edl --loader=prog_firehose_ddr.elf printgpt
edl --serial                            # autodetecta puerto serie
edl --portname \\.\COM1                 # puerto explícito
edl --debugmode                         # log verboso (requiere carpeta ./logs)
edl reset                               # reinicia
edl xml run.xml                         # envía un XML Firehose
edl rawxml "<data><response value=\"ACK\"/></data>"
edl server --memory=ufs --tcpport=1340  # servidor TCP
```

**eMMC**

```bash
edl printgpt                            # imprime GPT
edl rf flash.bin                        # dump completo del flash
edl rl dumps --skip=userdata --genxml   # dump de todas las particiones + rawprogram0.xml
edl rs 0 15 data.bin                    # 15 sectores desde el 0
edl r boot_a boot.img                   # lee una partición
edl r boot_a,boot_b a.img,b.img         # lee varias
edl footer footer.bin                   # crypto footer
edl w boot_a boot.img                   # escribe una partición
edl w gpt gpt.img                       # escribe la GPT
edl wl dumps                            # escribe todo un directorio
edl wf dump.bin                         # escribe una imagen cruda
edl e misc                              # borra una partición
edl gpt . --genxml                      # dumpea gpt_main0/gpt_backup0 + rawprogram0.xml
```

**UFS** (añadir `--memory=ufs` y `--lun=N`)

```bash
edl printgpt --memory=ufs --lun=0
edl printgpt --memory=ufs               # todos los LUN
edl rf lun0.bin --memory=ufs --lun=0
edl rf flash.bin --memory=ufs           # lun0_flash.bin, lun1_flash.bin…
edl rl dumps --memory=ufs --lun=0 --skip=userdata,vendor_a
edl rl dumps --memory=ufs --genxml
edl rs 0 15 data.bin --memory=ufs --lun=0
edl r boot_a boot.img --memory=ufs --lun=4
edl r boot_a boot.img --memory=ufs      # autodetecta LUN
edl w boot boot.img --memory=ufs --lun=4
edl w gpt gpt.img --memory=ufs --lun=4
edl wl dumps --memory=ufs --lun=0
edl wf dump.bin --memory=ufs --lun=0
edl e misc --memory=ufs --lun=0
edl gpt . --genxml --memory=ufs
```

**Emulación QFIL y memoria**

```bash
edl qfil rawprogram0.xml patch0.xml image_dir
edl peek 0x200000 0x10 mem.bin
edl peekhex 0x200000 0x10
edl peekqword 0x200000
edl pokeqword 0x200000 0x400000
edl poke 0x200000 mem.bin
edl secureboot                        # fuses de secure boot (solo EL3)
edl pbl pbl.bin                       # dump del PBL (solo EL3)
edl qfp qfp.bin                       # dump de qfprom (solo EL3)
edl modules oemunlock enable          # activa flag OEM (requiere partición config)
edl memorydump                        # volcado en modo 0x900E
```

✅ Todos extraídos del README oficial de `bkerler/edl`.

### 4.4 `qdl` (Linux)

```bash
qdl prog_firehose_ddr.elf rawprogram*.xml patch*.xml
qdl --serial=0AA94EFD prog_firehose_ddr.elf rawprogram*.xml patch*.xml
qdl --storage=ufs --slot=0 ...
qdl --include=DIR --allow-missing ...
qdl --skipblock=sha256 ...      # omite regiones idénticas
qdl --skip-reset ...            # deja el equipo en EDL
qdl --dry-run ...               # valida XML sin dispositivo
qdl --debug ...                 # log completo (SAHARA:/FIREHOSE:)
qdl chipinfo                    # identificación por Sahara, sin programador
qdl reset                       # reinicia equipo atascado en EDL
qdl flash installer.zip         # paquete con flashmap.json/contents.xml
```

✅ Documentado en el README de `linux-msm/qdl`. En Windows se compila con MSYS2/MinGW64; también corre desde WSL2 con `usbipd-win`.

### 4.5 QFIL (GUI oficial)

1. `Programmer Path` → `prog_firehose_*.elf` **del modelo exacto**.
2. `Flat Build` → `Load XML` → `rawprogram0.xml` + `patch0.xml`.
3. Confirmar COM correcto arriba.
4. `Download`.

✅ El paquete debe contener programador + `rawprogram*.xml` + `patch*.xml` + imágenes en **una sola carpeta** (isptestpoint, 16-jul-2026).

### 4.6 Licencias — dato crítico para una app comercial

🔴 `bkerler/edl` es **GPLv3** y añade: *"No use in commercial products without prior permit"*. Si la app distribuye o enlaza el código, debe abrir su fuente. `qdl` es BSD-3 (más permisiva). QPST/QFIL **no** son redistribuibles: hay que enlazar a la descarga del usuario.

---

## 5. Drivers

### 5.1 Qué driver hace falta

| Driver | Uso | Origen |
|---|---|---|
| **Qualcomm HS-USB QDLoader 9008** (`qcser.inf`) | EDL con QFIL/QPST | Paquete `Qualcomm_Drivers.zip` / instalador `QDLoader_HS-USB_Driver_64bit.exe` |
| **Qualcomm USB Driver v1.0.0.11** | Variante empaquetada del anterior, distribución de taller | Mismo paquete |
| **UsbDk** | `edl.py` en Windows (acceso libusb) | <https://github.com/daynix/UsbDk/releases/> |
| **Zadig** (alternativa) | Sustituir driver por WinUSB genérico | <https://zadig.akeo.ie/> |

⚠️ **Contradicción real entre fuentes:** temblast afirma "Do NOT use any Windows drivers from Qualcomm. They will try to present your device as a serial port" y recomienda Zadig/WinUSB. En cambio `edl.py` y QFIL **sí** funcionan con el driver serie de Qualcomm. Conclusión práctica: **QFIL → driver Qualcomm; edl.exe/edl.py → UsbDk o WinUSB**. No mezclar en la misma sesión.

### 5.2 Instalación manual (Windows)

1. Conectar el equipo en EDL.
2. `devmgmt.msc` → el dispositivo aparece como `QHUSB_BULK` en *Otros dispositivos*.
3. Clic derecho → *Actualizar controlador* → *Buscar en el equipo* → carpeta descomprimida.
4. Aceptar "Instalar de todos modos".
5. Verificar en **Puertos (COM y LPT)** → `Qualcomm HS-USB QDLoader 9008 (COMx)`.

### 5.3 Firma de drivers en Windows 10/11

🔴 El driver no está firmado por WHQL para todas las build; Windows lo bloquea con *"el controlador no se puede verificar"*.

**Desactivar temporalmente la comprobación de firma:**

1. `Configuración` → `Sistema` → `Recuperación` → `Reiniciar ahora` (con Shift).
2. `Solucionar problemas` → `Opciones avanzadas` → `Configuración de inicio` → `Reiniciar`.
3. Tecla **7** (*Deshabilitar el uso obligatorio de firma de controladores*).

**Modo test permanente** (más cómodo en un banco de taller):

```powershell
bcdedit /set testsigning on
bcdedit /set nointegritychecks on
# reiniciar; aparece marca de agua "Modo de prueba"
```

✅ Microsoft documenta que un paquete test-signed solo carga con *test-signing* habilitado (<https://learn.microsoft.com/en-us/windows-hardware/drivers/install/installing-test-signed-driver-packages>).

**Problemas típicos:**

| Síntoma | Causa | Solución |
|---|---|---|
| Triángulo amarillo en el 9008 | Firma no válida | Desactivar firma, reinstalar |
| El puerto desaparece a los segundos | Driver serie + `ModemManager`/servicio | Usar UsbDk; en Linux `systemctl stop ModemManager` |
| `Couldn't get device configuration` | Sin reglas udev (Linux) | Copiar `Drivers/51-edl.rules` a `/etc/udev/rules.d/` |
| COM distinto en cada conexión | Normal | Fijar por `--portname` |

✅ En Linux hay que **purgar `modemmanager`**: el README de `edl` lo indica explícitamente (`sudo apt purge modemmanager`).

---

## 6. Particiones: mapa, función y riesgo

### 6.1 Cadenas y propietarios

✅ El SoC tiene varios procesadores, cada uno con su firmware y su dominio de seguridad (guía de porting AOSP, `02-01-partitions-qualcomm.md`):

| Categoría | Particiones | Quién ejecuta |
|---|---|---|
| Cadena de arranque del CPU principal | `xbl`, `xbl_config`, `abl`, `devcfg` | CPU principal (entorno UEFI) |
| Seguridad y virtualización | `tz`, `hyp`, `uefisecapp`, `keymaster` | TrustZone / EL2 |
| Firmware de subsistemas | `modem`, `adsp`, `cdsp`, `slpi`, `bluetooth`, `wlan`, `npu` | DSP / módem / SLPI |
| Gestión de energía | `rpm`, `aop` | microcontroladores RPM/AOP |
| Sistema Android | `boot`, `dtbo`, `vbmeta`, `super`, `userdata`… | CPU principal (Linux) |

### 6.2 Tabla de particiones

| Partición | Contenido | Tocar = | Riesgo |
|---|---|---|---|
| `gpt` / `gpt_main0` / `gpt_backup0` | Tabla de particiones | Perder el mapa del almacenamiento | 🔴 **Crítico** (sin backup redundante en la mayoría) |
| `xbl` | Firmware UEFI (equivalente al BIOS) | No arranca ni llega a logo | 🔴 Crítico |
| `xbl_config` | Configuración de xbl, **pareja de versión obligatoria** | Cuelgue antes del logo, sin salida | 🔴 Crítico |
| `abl` | Bootloader Android (fastboot, AVB, selección de slot) | Sin fastboot, sin arranque | 🔴 Crítico |
| `devcfg` | Configuración de dispositivos de arranque | Fallo de verificación | 🔴 Alto |
| `tz` | TrustZone / TEE | Fallo de huella, DRM, keymaster | 🔴 Alto |
| `hyp` | Hipervisor (EL2) | Fallo de virtualización y arranque | 🔴 Alto |
| `keymaster` | Trusted Application de claves | Huella, DRM, cifrado | 🟠 Medio-alto |
| `uefisecapp` | App UEFI de arranque seguro | Verificación rota | 🟠 Medio-alto |
| `rpm` / `aop` | Gestión de energía | No duerme, no apaga, consumo anómalo | 🟠 Medio |
| `modem` | Firmware y pila del módem | **Sin señal, sin SIM, sin llamadas** | 🔴 Alto |
| `modemst1` / `modemst2` / `fsg` | NV del módem (IMEI, calibración RF) | IMEI perdido o duplicado | 🔴 **Muy alto** |
| `persist` | MAC de Wi-Fi/BT, calibración de sensores, datos de cámara, atestación | Wi-Fi/BT muertos, sensores locos, cámara fallando | 🔴 **Muy alto** |
| `persistbak` | Copia de `persist` | — | 🟠 Medio |
| `boot` / `init_boot` | Kernel + ramdisk | Sin arranque | 🟠 Medio (recuperable por fastboot) |
| `dtbo` | Overlays de árbol de dispositivos | Pantalla/táctil rotos | 🟠 Medio |
| `vbmeta` / `vbmeta_system` / `vbmeta_vendor` | Metadatos de AVB | Arranque verificado roto (naranja/rojo) | 🟠 Medio |
| `super` | Particiones dinámicas (`system`, `vendor`, `product`, `system_ext`, `odm`) | Sistema corrupto | 🟠 Medio (grande, lento) |
| `recovery` | Recovery | Sin recovery | 🟢 Bajo |
| `misc` | `bootloader_message` (comandos de arranque, contadores A/B) | Modo de arranque forzado | 🟢 Bajo |
| `metadata` | Clave de cifrado de metadatos | Pérdida de datos cifrados | 🟠 Medio |
| `userdata` | Datos de usuario | Borrado total | 🟢 Bajo (si hay backup) |
| `frp` | Factory Reset Protection | FRP reactivado | 🟢 Bajo |
| `devinfo` | Flags de desbloqueo OEM / estado del bootloader | Desbloqueo o relock | 🟠 Medio |
| `config` | Configuración de fábrica, permite `modules oemunlock` | — | 🟠 Medio |
| `efs2` / `sec` / `fota` | EFS, seguridad, OTA (plataformas NAND) | IMEI, OTA | 🔴 Alto |

### 6.3 Riesgos específicos

**`persist`** — ✅ Almacena MAC de Wi-Fi y Bluetooth, datos de sensores e IMEI relacionado. Muchas ROMs personalizadas la reescriben con datos ajenos y el resultado es "sin IMEI", Wi-Fi muerto y sensores sin calibrar (XDA 3787488). **Nunca se restaura de otro equipo**: cada unidad tiene su calibración.

**`modem` / `modemst*`** — ✅ El módem corre en su propio procesador con RTOS; el NV (calibración RF, IMEI) vive en su área y está ligado a `persist`. Un `modem` de otra región puede dar arranque correcto y **cero cobertura**.

**`xbl` / `xbl_config`** — ✅ Deben flashearse **como pareja de la misma versión**. Síntoma de mezcla: cuelgue antes del logo sin salida (guía AOSP, §2.5). `xbl` es cerrado: no se personaliza, solo se reemplaza.

**`tz` + `keymaster`** — ✅ Pareja funcional: desalinearlas rompe huella y DRM (§10.2 de la guía AOSP).

**`gpt`** — 🔴 Si se interrumpe la escritura de `gpt_main`, el equipo no localiza ni su propio bootloader. Es el punto con menos red de seguridad de todo el proceso (bitandboot, 2026).

---

## 7. Recuperación de un equipo brickeado

### 7.1 Regla de oro

🔴 **Nunca se escribe nada antes de tener un dump completo verificado.** Sin backup, un error de un minuto se convierte en una pérdida de `persist`/`modemst` irreversible.

### 7.2 Fase 0 — Preparación

- [ ] Modelo y **codename exactos** confirmados (no vale "parecido").
- [ ] Programador Firehose **del modelo y stepping exactos**.
- [ ] Paquete de firmware oficial completo, misma versión o superior.
- [ ] Cable corto y de calidad, **puerto USB 2.0** del panel trasero.
- [ ] Batería con carga >50 % o alimentación de banco.
- [ ] Espacio en disco ≥ 2× el tamaño del almacenamiento.
- [ ] Driver verificado, COM visible, sin amarillo.

### 7.3 Fase 1 — Backup obligatorio

```bash
# 1. Identificar almacenamiento y LUN
edl printgpt --memory=ufs

# 2. GPT de todos los LUN, con XML de restauración
edl gpt . --genxml --memory=ufs

# 3. Dump íntegro de cada LUN (o de todas las particiones)
edl rf backup_lun0.bin --memory=ufs --lun=0
edl rl dumps --memory=ufs --genxml          # todas las particiones, todos los LUN

# 4. Particiones críticas por separado, siempre
edl r persist persist.img --memory=ufs
edl r modemst1 modemst1.img --memory=ufs
edl r modemst2 modemst2.img --memory=ufs
edl r fsg fsg.img --memory=ufs
edl r devinfo devinfo.img --memory=ufs
edl r xbl xbl.img --memory=ufs
edl r abl abl.img --memory=ufs
```

### 7.4 Fase 2 — Verificación de integridad

```powershell
# Windows
Get-FileHash .\persist.img -Algorithm SHA256
Get-ChildItem *.img | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" } | Out-File hashes.txt
```

```bash
# Linux
sha256sum *.img > hashes.txt
sha256sum -c hashes.txt
```

**Criterios de validez:**

| Comprobación | Esperado |
|---|---|
| Tamaño de cada `.img` | Igual al tamaño de la partición en la GPT |
| `persist.img` | No todo `0x00` ni todo `0xFF` |
| `modemst1/2` | Tamaño exacto, contenido no uniforme |
| Relectura de control | `edl r persist persist_check.img` → hash idéntico |
| GPT | `gpt_main0.bin` y `gpt_backup0.bin` presentes y coherentes |

✅ `qdl` ofrece `--skipblock=sha256`, que pide al dispositivo el digest de cada región y omite las que ya coinciden: sirve como verificación nativa y acelera el reflasheo.

⚠️ Si `persist` sale uniforme, **para**: escribir encima destruye la calibración.

### 7.5 Fase 3 — Reparación

**Caso A — GPT corrupta**

```bash
edl w gpt gpt_main0.bin --memory=ufs --lun=0
edl w gpt_backup gpt_backup0.bin --memory=ufs --lun=0
```

**Caso B — Cadena de arranque rota** (orden importa)

```bash
edl w xbl xbl.img --memory=ufs
edl w xbl_config xbl_config.img --memory=ufs
edl w abl abl.img --memory=ufs
edl w devcfg devcfg.img --memory=ufs
edl w tz tz.img --memory=ufs
edl w hyp hyp.img --memory=ufs
edl reset
```

**Caso C — Flasheo completo**

```bash
edl qfil rawprogram0.xml patch0.xml .\images
# o
qdl prog_firehose_ddr.elf rawprogram*.xml patch*.xml
```

**Caso D — Restauración de identidad**

```bash
edl w persist persist.img --memory=ufs
edl w modemst1 modemst1.img --memory=ufs
edl w modemst2 modemst2.img --memory=ufs
edl w fsg fsg.img --memory=ufs
edl reset
```

### 7.6 Fase 4 — Validación post-flasheo

- [ ] Arranca y llega a setup (primer arranque puede tardar varios minutos).
- [ ] `*#06#` devuelve el IMEI correcto.
- [ ] Wi-Fi y Bluetooth encienden y conservan su MAC.
- [ ] Sensores (giroscopio, proximidad, luz) responden.
- [ ] Cámara abre sin error.
- [ ] Cobertura de red y llamada.
- [ ] Huella dactilar.
- [ ] `fastboot getvar unlocked` coherente con el estado esperado.

⚠️ Si falla IMEI/Wi-Fi/sensores tras un flasheo "correcto", el problema es `persist`/`modemst`, no el firmware. Restaurar del backup.

---

## 8. Errores frecuentes: causa y diagnóstico

| Mensaje | Significado real | Causa | Diagnóstico / solución |
|---|---|---|---|
| `Sahara fail` / `Sahara communication failed` | Fallo en el handshake o en la carga del programador | Programador de otro modelo/stepping, cable, USB 3.x | Cambiar programador por el exacto; USB 2.0; cable corto |
| `Firehose fail` | El programador cargó pero rechazó el XML | XML de otro modelo, sector size erróneo, LUN incorrecto | Revisar `rawprogram*.xml`; `--memory`/`--lun` correctos |
| `Only nop and sig tag can be recevied before authentication` | El PBL exige auth y no se ha hecho | Equipo con auth obligatoria | Cuenta autorizada, herramienta comercial o bypass `blob2` en programadores antiguos |
| `Error on EDL Authentification` | La firma enviada no valida | Challenge ya generado, blob incorrecto, reloj/sesión | Reconectar y encender de nuevo **antes** de cada intento; no enviar `req` con otra herramienta |
| `QDL error` / `ERROR n: Line xxxx: STORAGE_READ_FAILURE` | El programador no puede leer/escribir ese rango | Sector size distinto (512 vs 2048), NAND con bloques malos, LUN erróneo | Ajustar `--memory`/block size; en NAND, `edl` gestiona bloques malos solo |
| `Cannot read packet` / `Cannot receive hello packet` | Se perdió el enlace | Cable, hub, puerto 3.x, driver | Reentrar en EDL, cambiar cable y puerto |
| `Invalid ELF` / `Unknown response received on uploading loader` | El archivo no es un ELF válido o no es para ese chip | Extensión `.mbn`/`.bin` que no es ELF, archivo corrupto, programador ajeno | Verificar cabecera `\x7fELF`; descargar de nuevo del paquete oficial |
| `Couldn't find a loader for given hwid and pkhash` | Autodetección sin coincidencia | Loader no está en `Loaders/` | `--loader=` explícito o `fhloaderparse` |
| `Peek command isn't supported by edl loader` | El programador no implementa `peek`/`poke` | Loader no es ELF de nivel EL3 | Usar otro programador o renunciar a `peek`/`poke` |
| `Attribute 'SECTOR_SIZE_IN_BYTES'=512 must be equal to disk sector size 2048` | Desajuste de tamaño de sector | XML de eMMC sobre NAND/UFS | Especificar block size; a veces es inocuo y solo afecta a escritura |
| `Preflash validation failed` (fastboot) | Firma de imagen no válida para ese bootloader | Imagen de otra versión/región | Usar imágenes del paquete oficial exacto |
| Timeout genérico | El dispositivo dejó de responder | Se durmió, se desconectó, se colgó el programador | `edl reset`, reconectar, revisar alimentación |
| `USBError(19, 'No such device')` tras `reset` | El equipo se fue antes de responder | **Normal** | Ninguna acción |
| `No --memory option set, we assume "UFS"` | Aviso, no error | Falta `--memory` | Añadir `--memory=ufs`/`emmc`/`nand` |

### 8.1 Árbol de decisión

```
¿Aparece 05C6:9008?
├─ NO → ¿Aparece 900E? → sí: rehacer test point sin batería
│                        no: driver / cable / hardware (§2.4, §5)
└─ SÍ
   ├─ ¿Falla al cargar el programador? → programador incorrecto o auth (§2.6)
   ├─ ¿Carga pero falla el primer comando? → XML/LUN/sector size
   ├─ ¿Falla a mitad de escritura? → cable/puerto/alimentación
   └─ ¿Todo OK pero no arranca? → versión de firmware, ARB, particiones de identidad
```

⚠️ **Regla de diagnóstico:** el mensaje exacto y la línea donde se detiene dicen más que la barra de progreso. Leer siempre el log completo antes de reintentar.

---

## 9. Foros y comunidades

| Fuente | Qué buscar | Qué evitar |
|---|---|---|
| **XDA Developers** (<https://xdaforums.com>) | Hilos por modelo con etiqueta `[Guide]`, tag `blankflash`, `test point`, `EDL` | Guías sin fecha: la mitad son de la era pre-auth |
| **4PDA** (<https://4pda.to/forum/index.php?showtopic=643084>) | Hilo "Общие принципы восстановления загрузчиков на Qualcomm" — principios de recuperación de bootloaders | Traducción automática deficiente en pasos críticos |
| **GitHub — bkerler/edl issues** (<https://github.com/bkerler/edl/issues>) | Mensajes de error literales; 272 issues con logs reales | Issues cerrados sin solución |
| **GitHub — linux-msm/qdl** | Comportamiento del protocolo, VIP, UFS provisioning | — |
| **GitHub — bkerler/Loaders** | Programadores por HWID/PKHASH | Loaders sin verificar procedencia |
| **GSM-Forum / GSMHosting** (<https://forum.gsmhosting.com>) | Foro oficial de Chimera; casos de auth y FRP | Ruido comercial |
| **Martview-Forum** | Discusión de herramientas comerciales | No es foro oficial |
| **Hovatek** (<https://www.hovatek.com/forum>) | Blankflash y recuperaciones Motorola | — |
| **Telegram** | Grupos de EDL/unbrick por marca; circulan programadores y cuentas de auth | Sin control de versiones: verificar siempre hash |
| **Biblioteca de test points de Chimera** | Fotos de PCB y pinouts | Solo cubre modelos soportados |

**Términos de búsqueda útiles:** `"05C6:9008"`, `"prog_firehose" + codename`, `"Only nop and sig"`, `"blankflash" + modelo`, `"test point" + modelo`, `"rawprogram0.xml"`.

---

## 10. Advertencias legales y de seguridad

### 10.1 Anti-rollback (ARB)

✅ El ARB se implementa con **fusibles qfprom** de un solo sentido: al actualizar, el contador de seguridad sube y **no baja**. Un `xbl`/`abl` de versión inferior se rechaza o deja el equipo muerto.

Caso documentado y grave (XDA 4775930, 18-ene-2026, actualizado 24-jun-2026): la actualización ColorOS 16.0.3.501 de OnePlus 13/15/13T sopló el fusible ARB. Consecuencias reportadas:

- Imposible volver a una ROM anterior: **hard brick**.
- Las herramientas 9008 no autorizadas y los programadores de Chimera **dejan de funcionar**.
- Una segunda oleada (16.0.8.xxx, junio 2026) sopló un fusible **distinto**, que anula el acceso EDL gratuito de por vida incluso sin bloquear la versión ARB.

⚠️ **Opinión:** en 2026 la regla de taller es "no actualizar un equipo que va a pasar por el banco hasta saber el estado del fusible". No hay forma de leer ese estado sin intentar un unbrick real.

### 10.2 Bootloader bloqueado

- EDL **no** desbloquea por sí solo: escribe el flag en `devinfo`, pero el desbloqueo lo consuma `fastboot oem unlock <code>` con el código del OEM.
- Con bootloader bloqueado, `fastboot flash` aplica **validación de firma** (`Preflash validation failed` si la imagen no es del paquete exacto).
- Desbloquear borra `userdata` y muestra aviso de arranque.

### 10.3 MDM, FRP y Knox

| Mecanismo | Qué hace | Efecto del flasheo |
|---|---|---|
| **FRP** (Google) | Exige la cuenta tras un reset | Se reactiva si se borra `frp`/`userdata` sin quitar la cuenta |
| **EFRP** (Android Enterprise) | Restringe qué cuentas pueden activar | Debe configurarse **antes** del reset (Google, doc oficial) |
| **MDM / Device Owner** | Bloquea opciones, incluido el interruptor de desbloqueo OEM | Un flasheo completo elimina la inscripción; un flasheo parcial no |
| **Knox (Samsung)** | Fusible de hardware `warranty void` | Flashear ROM **oficial** por Odin **no** lo dispara; recovery/kernel/root personalizados sí → `0x1` permanente, Samsung Pay y Secure Folder dejan de funcionar |

✅ Sobre Knox: el flag es un fusible de hardware, **no se puede volver a `0x0`** con ningún software (dev.to/samfware, 25-oct-2026).

### 10.4 Qué se pierde al flashear

- 🔴 **Todos los datos de usuario** (`userdata`), salvo flasheo parcial selectivo.
- 🔴 **Calibración de identidad** si se toca `persist`/`modemst` sin backup: IMEI, MAC Wi-Fi/BT, sensores.
- 🟠 **Estado de desbloqueo** y avisos de arranque.
- 🟠 **Inscripción MDM** y perfiles de trabajo.
- 🟠 **Widevine L1** en algunos modelos tras desbloquear (degradación a L3).
- 🟠 **Garantía**: sellos, Knox `0x1`, registro de modificaciones.
- 🟢 **Actualizaciones OTA** si el firmware queda desalineado con el canal.

### 10.5 Marco legal

- **Licencias de software:** `edl` es GPLv3 con cláusula de permiso comercial; `qdl` es BSD-3; QPST/QFIL son propiedad de Qualcomm y no redistribuibles.
- **Firmware:** propiedad del OEM; se distribuye por tolerancia. Los programadores Firehose suelen ser extraídos de paquetes oficiales.
- **IMEI:** la reparación de IMEI es legal en la mayoría de jurisdicciones si el número es propio o está autorizado; la *duplicación* del mismo IMEI en dos equipos es el error habitual.
- **Cuentas de auth:** su reventa es un servicio, no un derecho; el acceso puede cambiar sin aviso.
- **Datos del cliente:** un flasheo destruye pruebas; conviene aviso firmado y, si el equipo arranca, extracción previa.

---

## 11. Anexos

### 11.1 Glosario

| Término | Definición |
|---|---|
| **PBL** | *Primary Boot Loader*, en ROM del SoC; implementa EDL y Sahara |
| **Sahara** | Protocolo binario de carga del programador (comandos `0x01`–`0x14`) |
| **Firehose** | Protocolo XML sobre USB del programador ya cargado |
| **Programador / loader** | ELF firmado que se ejecuta en SRAM y expone Firehose |
| **PK_HASH** | Hash de la clave pública del OEM, identifica el programador válido |
| **HWID** | Identificador de chip (MSM_ID + OEM_ID + MODEL_ID) |
| **LUN** | Unidad lógica UFS; el almacenamiento se divide en varias |
| **ARB** | *Anti-Rollback*, fusible que impide bajar de versión |
| **AVB** | *Android Verified Boot*, cadena de verificación de imágenes |
| **GPT** | Tabla de particiones GUID |
| **900E** | Modo diagnóstico/crash dump, distinto de 9008 |

### 11.2 Estructura de paquete Sahara (referencia)

✅ Cabecera común de 8 bytes: `command` (u32) + `length` (u32), seguida de payload específico. Comandos: `0x01` HELLO (dispositivo→host), `0x02` HELLO_RESP, `0x03` READ_DATA, `0x04` END_OF_IMAGE, `0x05` DONE, `0x06` DONE_RESP, `0x07` RESET, `0x08` RESET_RESP, `0x09` MEM_DEBUG, `0x0A` MEM_READ, `0x0B` CMD_READY, `0x0C` SWITCH_MODE, `0x0D` EXECUTE, `0x0E` EXECUTE_RESP, `0x0F` EXECUTE_DATA, `0x10` MEM_DEBUG64, `0x11` MEM_READ64, `0x12` READ_DATA64, `0x13` RESET_STATE, `0x14` WRITE_DATA. Modos: `0` IMAGE_TX_PENDING, `1` IMAGE_TX_COMPLETE, `2` MEMORY_DEBUG, `3` COMMAND.

### 11.3 Ejemplo de XML Firehose

```xml
<?xml version="1.0" ?>
<data>
  <program SECTOR_SIZE_IN_BYTES="512" file_sector_offset="0" filename="sbl1.bin"
           label="sbl1" num_partition_sectors="1024" physical_partition_number="0"
           size_in_KB="512.0" sparse="false" start_byte_hex="0xc082000" start_sector="394256" />
</data>
```

✅ Ejemplo de Aleph Research. Respuestas del dispositivo: `<response value="ACK"/>`, `<response value="NAK"/>`, `<log value="..."/>`, y `rawmode="true"` cuando empieza la transferencia binaria.

### 11.4 Checklist imprimible de banco

```
[ ] Modelo + codename confirmados
[ ] Programador del stepping exacto
[ ] Firmware oficial completo
[ ] Driver OK, COM visible, sin amarillo
[ ] USB 2.0, cable corto
[ ] Batería >50 % o banco
[ ] Espacio en disco 2x almacenamiento
[ ] printgpt OK
[ ] gpt --genxml guardado
[ ] Dump completo + persist + modemst1/2 + fsg + devinfo
[ ] Hashes calculados y verificados
[ ] Relectura de control idéntica
[ ] ---- a partir de aquí se escribe ----
[ ] Validación post-flasheo (IMEI, Wi-Fi, BT, sensores, cámara, red, huella)
```

---

## 12. Fuentes

Todas consultadas el 31-oct-2026.

**Primarias / técnicas**

1. Aleph Research, *Qualcomm EDL Firehose Programmers Peek and Poke Primitives* (ALEPH-2017028, 22-ene-2018) — <https://alephsecurity.com/vulns/aleph-2017028>
2. `bkerler/edl` — README y referencia de comandos — <https://github.com/bkerler/edl>
3. `linux-msm/qdl` — README, `qdl reset`, `--skipblock=sha256` — <https://github.com/linux-msm/qdl>
4. DeepWiki/qdl, *Sahara Commands* (tabla de comandos 0x01–0x14) — <https://deepwiki.com/linux-msm/qdl/3.1-sahara-commands>
5. DeepWiki/qdl, *XML Command Protocol* (ACK/NAK, rawmode, atributos) — <https://deepwiki.com/linux-msm/qdl/4.2-xml-command-protocol>
6. LKML/dri-devel, *Add documentation for Sahara protocol* (Qualcomm, jul-2026) — <https://lists.freedesktop.org/archives/dri-devel/2026-July/581414.html>
7. `HsOjo/edl-noauth-kit` — mecánica del bypass `blob2` — <https://github.com/HsOjo/edl-noauth-kit>
8. temblast, *EDL Utility* (actualizado 28-oct-2026) — <https://www.temblast.com/edl.htm>
9. Guía de porting AOSP, *Snapdragon Platform Partitions and Bootloader* — <https://github.com/1shin-7/aosp-porting-guide/blob/master/en/02-platform/02-01-partitions-qualcomm.md>
10. AOSP, *Descripción general de las particiones* (act. 11-oct-2026) — <https://source.android.com/docs/core/architecture/partitions>
11. Microsoft Learn, *Installing Test-Signed Driver Packages* — <https://learn.microsoft.com/en-us/windows-hardware/drivers/install/installing-test-signed-driver-packages>

**Casos y procedimientos**

12. XDA, *[GUIDE] Some hints about EDL mode* (20-may-2024) — <https://xdaforums.com/t/guide-some-hints-about-edl-mode.4672703/>
13. XDA, *Boot to 9008 Mode using Test Point Method* (23-mar-2023) — <https://xdaforums.com/t/boot-to-9008-mode-edl-mode-using-test-point-method.4568025/>
14. XDA, *Backup persist partition* — <https://xdaforums.com/t/guide-backup-persist-partition-save-wifi-mac-bluetooth-mac-sensors-data.3787488/>
15. XDA, *ColorOS 16.0.8.xxx / 16.0.3.501 = ARB permanente* (18-ene-2026, act. 24-jun-2026) — <https://xdaforums.com/t/critical-warning-coloros-16-0-8-xxx-16-0-3-501-permanent-anti-rollback-arb-fuse-blown-do-not-update.4775930/>
16. `bkerler/edl` issue #464, *Error on EDL Authentification* — <https://github.com/bkerler/edl/issues/464>
17. `bkerler/edl` issue #714, `STORAGE_READ_FAILURE` / sector size — <https://github.com/bkerler/edl/issues/714>
18. isptestpoint, *How to Use QFIL / QPST* (16-jul-2026) — <https://isptestpoint.com/how-to-use-qfil-qpst-to-flash-qualcomm-firmware-in-edl-mode>
19. romwala, *Qualcomm EDL Mode (9008): Test Points* (10-oct-2026) — <https://romwala.com/blog/qualcomm-edl-mode-9008-test-points-boot-guide>
20. bitandboot Systems Lab, *Qualcomm EDL Forensics* (2026) — <https://bitandboot.github.io/edl-mode-guide.html>
21. DroidWin, *Fix 900E instead of QDLoader 9008* (19-may-2025) — <https://droidwin.com/fix-qualcomm-hs-usb-diagnostic-900e-instead-of-qdloader-9008/>
22. DroidWin, *Qualcomm HS-USB QDLoader 9008 Drivers* — <https://droidwin.com/download-install-qualcomm-hs-usb-qdloader-9008-drivers/>
23. DroidWin, *Unbrick Motorola via BlankFlash* (2-oct-2025) — <https://droidwin.com/how-to-unbrick-motorola-device-via-blankflash/>
24. Wikipedia, *Qualcomm EDL mode* — <https://en.wikipedia.org/wiki/Qualcomm_EDL_mode>

**Herramientas comerciales y legal**

25. ChimeraTool, *Modo EDL de Qualcomm* (act. 31-oct-2026) — <https://chimeratool.com/docs/qualcomm-edl-mode>
26. Chimera News, *Tool Pulse Q3 2026* (5-oct-2026) — <https://news.chimeratool.com/2026/10/05/chimera-tool-pulse-q3-2026/>
27. UnlockTool, modelos soportados — <https://www.unlocktool.org/supported-models>
28. dev.to/samfware, *What the Knox warranty void flag actually means* (25-oct-2026) — <https://dev.to/samfware/what-the-knox-warranty-void-flag-actually-means-after-you-flash-samsung-firmware-413m>
29. Google, *Enable enterprise factory reset protection* — <https://support.google.com/work/android/answer/14549362>
30. 4PDA, *Общие принципы восстановления загрузчиков на Qualcomm* — <https://4pda.to/forum/index.php?showtopic=643084>

---

### Nota final sobre vigencia

Este documento refleja el estado a **31-oct-2026**. Los puntos que caducan más rápido son: requisitos de autenticación por modelo, estado de los fusibles ARB y disponibilidad de programadores. Revisar §2.6 y §10.1 antes de cada intervención sobre un modelo nuevo.

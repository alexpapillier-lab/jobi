// GENEROVÁNO – needituj. Zdroj: docs/api/openapi.yaml
// Přegeneruj přes: npm run api:spec
export const POPIS = {
  "openapi": "3.1.0",
  "info": {
    "title": "Jobi – veřejné API servisu",
    "version": "1.1.0",
    "license": {
      "name": "Proprietární – součást aplikace Jobi"
    },
    "description": "Ceník oprav a sklad servisu pro použití na vlastním webu.\n\nČtení je veřejné a bez tokenu – token v JavaScriptu na stránce stejně\nnení tajemství a rozbíjel by cachování. Servis se identifikuje slugem\nv parametru `service`.\n\nZápis token vyžaduje (`Authorization: Bearer jobi_…`).\n\nObjednávky oprav z webu (`/orders`) taky – token se scope `orders`.\nServis se o nich dozví v Jobi a web dostává zpět webhooky o zakázce\n(viz sekce Webhooks). Česky podrobně: docs/API_OBJEDNAVKY.md.\n\nCeník a sklad jsou samostatné moduly. Servis, který má zapnutý jen\njeden z nich, dostane u druhého 404 – stejně jako když slug neexistuje.\nJe to schválně: přes API nemá jít zjišťovat, které servisy existují.\n"
  },
  "security": [],
  "servers": [
    {
      "url": "https://api.appjobi.com/v1",
      "description": "Produkce"
    },
    {
      "url": "https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1",
      "description": "Přímo edge funkce, bez cache a limitů. Pro ladění."
    }
  ],
  "paths": {
    "/catalog": {
      "get": {
        "summary": "Ceník oprav",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          },
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "responses": {
          "200": {
            "description": "Ceník servisu",
            "headers": {
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Katalog"
                }
              }
            }
          },
          "304": {
            "description": "Beze změny od posledního dotazu"
          },
          "400": {
            "$ref": "#/components/responses/ChybiService"
          },
          "404": {
            "$ref": "#/components/responses/Nedostupne"
          }
        }
      }
    },
    "/inventory": {
      "get": {
        "summary": "Sklad",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          },
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "responses": {
          "200": {
            "description": "Sklad servisu",
            "headers": {
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sklad"
                }
              }
            }
          },
          "304": {
            "description": "Beze změny od posledního dotazu"
          },
          "400": {
            "$ref": "#/components/responses/ChybiService"
          },
          "404": {
            "$ref": "#/components/responses/Nedostupne"
          }
        }
      }
    },
    "/embed.js": {
      "get": {
        "summary": "Hotový skript, který ceník vykreslí na stránku",
        "description": "Vloží se do stránky takhle:\n\n```html\n<div id=\"jobi-cenik\"></div>\n<script src=\"https://api.appjobi.com/v1/embed.js?service=nazev-servisu\"></script>\n```\n",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          }
        ],
        "responses": {
          "200": {
            "description": "JavaScript",
            "content": {
              "application/javascript": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    },
    "/booking": {
      "get": {
        "summary": "Nastavení online rezervací",
        "description": "Otevírací dny a hodiny pro formulář rezervace. 404, když servis rezervace nemá zapnuté.",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          }
        ],
        "responses": {
          "200": {
            "description": "Nastavení formuláře",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "service": {
                      "type": "string",
                      "description": "Název servisu"
                    },
                    "dny": {
                      "type": "array",
                      "items": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 7
                      },
                      "description": "1 = pondělí … 7 = neděle"
                    },
                    "od": {
                      "type": "string",
                      "example": "09:00"
                    },
                    "do": {
                      "type": "string",
                      "example": "17:00"
                    },
                    "krokMin": {
                      "type": "integer",
                      "example": 30
                    },
                    "uvod": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "$ref": "#/components/responses/Nedostupne"
          }
        }
      },
      "post": {
        "summary": "Nová rezervace",
        "description": "Nezávazná rezervace termínu. Bez tokenu; chrání ji limit 10 rezervací za hodinu\nz jedné adresy a 60 za hodinu na servis (429) a skryté pole `web`, které musí\nzůstat prázdné. Servis dostane e-mail a rezervaci vidí v Jobi v Kalendáři.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "service",
                  "name",
                  "phone",
                  "device"
                ],
                "properties": {
                  "service": {
                    "type": "string",
                    "description": "Slug servisu"
                  },
                  "name": {
                    "type": "string",
                    "maxLength": 120
                  },
                  "phone": {
                    "type": "string",
                    "maxLength": 40
                  },
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "device": {
                    "type": "string",
                    "maxLength": 160,
                    "description": "Zařízení (např. iPhone 13)"
                  },
                  "repair": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Co je potřeba opravit (volný text)"
                  },
                  "repair_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "Oprava z ceníku (`/catalog` → repairs[].id); název a cena se berou z ceníku"
                  },
                  "model_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "Model z ceníku (`/catalog` → models[].id)"
                  },
                  "preferred_at": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Přání termínu; prázdné = kdykoliv"
                  },
                  "note": {
                    "type": "string",
                    "maxLength": 1000
                  },
                  "web": {
                    "type": "string",
                    "description": "Skryté pole proti robotům – nechte prázdné"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Rezervace přijata",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Chybí nebo je špatně jméno",
            "telefon": null,
            "zařízení": null,
            "e-mail nebo termín": null
          },
          "404": {
            "$ref": "#/components/responses/Nedostupne"
          },
          "429": {
            "description": "Příliš mnoho rezervací; hlavička Retry-After"
          }
        }
      }
    },
    "/booking.js": {
      "get": {
        "summary": "Hotový formulář rezervace k vložení na web",
        "description": "`<div id=\"jobi-rezervace\"></div>` a `<script src=\"…/booking.js?service=slug\"></script>`.\nSkript vykreslí formulář, po odeslání zavolá `POST /booking` a ukáže poděkování.\n",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          }
        ],
        "responses": {
          "200": {
            "description": "JavaScript",
            "content": {
              "application/javascript": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    },
    "/write": {
      "post": {
        "summary": "Zápis do skladu a ceníku",
        "description": "Produkty a opravy jde upravovat, zakládat (`create: true` u produktu;\noprava bez `id` se založí) i mazat (`delete: true`, jen podle `id`).\nZnačky, kategorie a modely (`brands`, `categories`, `models`) jde\nzakládat a přejmenovávat; mazání katalogu zůstává v aplikaci, protože\nkaskádou odnese modely i opravy. Vazby (`category_id`, `model_ids`,\n`product_ids`, `brand_id`) se přijmou jen na záznamy téhož servisu,\ncizí id se vynechá a oznámí v `errors`. Nová id jsou v `created_ids`.\n\nPořadí zpracování: brands → categories → models → repairs → products.\nLimit 30 zápisů za minutu na token.\n",
        "security": [
          {
            "TokenApi": []
          }
        ],
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Doporučené. Když se požadavek při výpadku sítě odešle dvakrát,\npodruhé se vrátí uložená odpověď (hlavička `Idempotency-Replayed:\ntrue`) a nic se neprovede znovu. Stejný klíč s jiným tělem\nskončí na 409.\n"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Zapis"
              },
              "examples": {
                "sklad": {
                  "summary": "Doplnění skladu z pokladny",
                  "value": {
                    "products": [
                      {
                        "sku": "BAT-6S",
                        "stock": 4
                      }
                    ]
                  }
                },
                "cena": {
                  "summary": "Změna ceny opravy",
                  "value": {
                    "repairs": [
                      {
                        "id": "0a7587f1-1111-4222-8333-444455556666",
                        "price": 1490
                      }
                    ]
                  }
                },
                "katalog": {
                  "summary": "Nový model a oprava k němu",
                  "value": {
                    "models": [
                      {
                        "name": "iPhone 16",
                        "category_id": "0a7587f1-1111-4222-8333-444455556666"
                      }
                    ]
                  }
                },
                "novy_produkt": {
                  "summary": "Založení dílu ve skladu",
                  "value": {
                    "products": [
                      {
                        "create": true,
                        "name": "Baterie iPhone 16",
                        "sku": "BAT-16",
                        "price": 990,
                        "purchase_price": 450,
                        "min_stock": 2,
                        "stock": 5
                      }
                    ]
                  }
                },
                "smazani": {
                  "summary": "Smazání opravy",
                  "value": {
                    "repairs": [
                      {
                        "id": "0a7587f1-1111-4222-8333-444455556666",
                        "delete": true
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Provedeno",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/VysledekZapisu"
                }
              }
            }
          },
          "207": {
            "description": "Provedeno částečně – některé položky měly chybu",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/VysledekZapisu"
                }
              }
            }
          },
          "400": {
            "description": "Tělo neobsahuje products ani repairs, nebo není platný JSON"
          },
          "401": {
            "description": "Chybějící, neplatný nebo odvolaný token"
          },
          "403": {
            "description": "Token nemá potřebný rozsah"
          },
          "409": {
            "description": "Idempotency-Key už byl použit s jiným tělem"
          },
          "429": {
            "description": "Překročen limit zápisů",
            "headers": {
              "Retry-After": {
                "schema": {
                  "type": "string"
                },
                "description": "Za kolik sekund to zkusit znovu"
              }
            }
          }
        }
      }
    },
    "/orders": {
      "post": {
        "summary": "Poslat nebo aktualizovat objednávky opravy",
        "description": "Objednávka opravy z formuláře na webu nebo z e-shopu („Pošlete nám\nzařízení“). V Jobi se objeví v Zakázkách → Příchozí objednávky\na na stránce Dnes; když zařízení dorazí, servis z ní jedním\nkliknutím založí zakázku a web dostane webhook `order.converted`.\n\n**Idempotence:** `external_id` je v servisu jedinečné. Stejné číslo\nposlané znovu objednávku jen aktualizuje (PATCH – mění se jen\nposlaná pole, `null` hodnotu smaže). Když se nic nezměnilo, výsledek\nje `unchanged`. Opakovat požadavek po výpadku sítě je tedy bezpečné.\n\n**Stav:** `new` → `in_transit` (předáno dopravci) → `arrived`; zrušit\njde `cancelled`. `converted` nastavuje jen Jobi (vznik zakázky); pak\njde měnit už jen `shipping.tracking`, `note` a `data`.\n\nLimit 60 požadavků za minutu na token, nejvýš 50 objednávek\nv požadavku, tělo do 512 kB.\n\n```bash\ncurl -X POST https://api.appjobi.com/v1/orders \\\n  -H \"Authorization: Bearer jobi_…\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"orders\":[{\"external_id\":\"SRV-2026-0123\",\"customer\":{\"name\":\"Jan Novák\",\"phone\":\"+420777123456\"},\"device\":{\"name\":\"iPhone 13\"},\"issue\":\"Prasklý displej\",\"shipping\":{\"inbound\":\"DPD\",\"outbound\":\"Zásilkovna\"}}]}'\n```\n",
        "security": [
          {
            "TokenApi": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "orders"
                ],
                "properties": {
                  "orders": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 50,
                    "items": {
                      "$ref": "#/components/schemas/Objednavka"
                    }
                  }
                }
              },
              "examples": {
                "nova": {
                  "summary": "Nová objednávka z formuláře „Zaslat zařízení“",
                  "value": {
                    "orders": [
                      {
                        "external_id": "SRV-2026-0123",
                        "source": "servis.iswap.cz",
                        "customer": {
                          "name": "Jan Novák",
                          "phone": "+420777123456",
                          "email": "jan@example.cz",
                          "address": {
                            "street": "Dlouhá 1",
                            "city": "Praha",
                            "zip": "110 00"
                          }
                        },
                        "device": {
                          "name": "iPhone 13",
                          "serial": "356789123456789",
                          "passcode": "1234",
                          "accessories": "obal"
                        },
                        "issue": "Prasklý displej, nereaguje dotyk",
                        "requested_repair": "Výměna displeje",
                        "shipping": {
                          "inbound": "DPD",
                          "outbound": "Zásilkovna",
                          "pickup_point": {
                            "id": "1234",
                            "name": "Z-BOX Praha 7"
                          }
                        },
                        "consent": {
                          "id": "c-7f3a9e21",
                          "signed_at": "2026-10-13T14:32:05+02:00",
                          "method": "checkbox",
                          "signer_name": "Jan Novák",
                          "ip": "203.0.113.7",
                          "user_agent": "Mozilla/5.0 …",
                          "terms_version": "2026-09",
                          "text_hash": "sha256:9f86d0…"
                        }
                      }
                    ]
                  }
                },
                "na_ceste": {
                  "summary": "Zákazník předal balík dopravci",
                  "value": {
                    "orders": [
                      {
                        "external_id": "SRV-2026-0123",
                        "status": "in_transit",
                        "shipping": {
                          "tracking": [
                            {
                              "carrier": "dpd",
                              "number": "13912345678901",
                              "direction": "inbound"
                            }
                          ]
                        }
                      }
                    ]
                  }
                },
                "zruseni": {
                  "summary": "Zákazník objednávku zrušil",
                  "value": {
                    "orders": [
                      {
                        "external_id": "SRV-2026-0123",
                        "status": "cancelled"
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Vše uloženo",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/VysledekObjednavek"
                }
              }
            }
          },
          "207": {
            "description": "Některé položky mají chybu (`errors`), ostatní jsou uložené",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/VysledekObjednavek"
                }
              }
            }
          },
          "400": {
            "description": "Tělo není JSON",
            "chybí `orders` nebo je jich víc než 50": null
          },
          "401": {
            "description": "Chybějící",
            "neplatný nebo odvolaný token": null
          },
          "403": {
            "description": "Token nemá scope `orders`",
            "nebo servis nemá veřejné API": null
          },
          "413": {
            "description": "Tělo je větší než 512 kB"
          },
          "429": {
            "description": "Překročen limit 60 požadavků za minutu",
            "headers": {
              "Retry-After": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "Stav objednávky a zakázky v Jobi",
        "description": "```bash\ncurl \"https://api.appjobi.com/v1/orders?external_id=SRV-2026-0123\" -H \"Authorization: Bearer jobi_…\"\n```\nOdpověď se necachuje.\n",
        "security": [
          {
            "TokenApi": []
          }
        ],
        "parameters": [
          {
            "name": "external_id",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "maxLength": 100
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Objednávka",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "order": {
                      "$ref": "#/components/schemas/StavObjednavky"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Chybí external_id"
          },
          "401": {
            "description": "Neplatný token"
          },
          "403": {
            "description": "Token nemá scope `orders`"
          },
          "404": {
            "description": "Objednávka s tímhle číslem v servisu není"
          }
        }
      }
    },
    "/order-form": {
      "get": {
        "summary": "Nastavení vložitelného formuláře objednávky",
        "description": "404, když servis formulář nemá zapnutý (Nastavení → API → Objednávky z webu) nebo nemá veřejné API.",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          }
        ],
        "responses": {
          "200": {
            "description": "Nastavení",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "service": {
                      "type": "string"
                    },
                    "uvod": {
                      "type": "string"
                    },
                    "podminky": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "description": "Odkaz na obchodní podmínky"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "$ref": "#/components/responses/Nedostupne"
          }
        }
      },
      "post": {
        "summary": "Objednávka opravy z formuláře Jobi",
        "description": "Bez tokenu, pro servisy bez vlastního formuláře. Objednávka vznikne se zdrojem\n„formulář Jobi“ a číslem JOBI-RRMMDD-XXXXXX; zaškrtnutý souhlas (`consent: true`)\nse uloží jako elektronické odsouhlasení (čas, IP, prohlížeč). Limit 10 objednávek\nza hodinu z jedné adresy a 60 na servis (429), skryté pole `web` musí zůstat prázdné.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "service",
                  "name",
                  "phone",
                  "device",
                  "issue",
                  "consent"
                ],
                "properties": {
                  "service": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string",
                    "maxLength": 200
                  },
                  "phone": {
                    "type": "string",
                    "maxLength": 40
                  },
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "device": {
                    "type": "string",
                    "maxLength": 200
                  },
                  "serial": {
                    "type": "string",
                    "maxLength": 100
                  },
                  "issue": {
                    "type": "string",
                    "maxLength": 4000
                  },
                  "model_id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "repair_id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "handoff": {
                    "type": "string",
                    "enum": [
                      "osobne",
                      "postou"
                    ]
                  },
                  "street": {
                    "type": "string",
                    "description": "Adresa pro vrácení (povinná při handoff: postou)"
                  },
                  "city": {
                    "type": "string"
                  },
                  "zip": {
                    "type": "string"
                  },
                  "note": {
                    "type": "string",
                    "maxLength": 4000
                  },
                  "consent": {
                    "type": "boolean",
                    "description": "Souhlas se zakázkovým listem a podmínkami – musí být true"
                  },
                  "web": {
                    "type": "string",
                    "description": "Skryté pole proti robotům – nechte prázdné"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Přijato – { ok: true, number: \"JOBI-261013-7KQ2MX\" }"
          },
          "400": {
            "description": "Chybí nebo je špatně vyplněné pole"
          },
          "404": {
            "$ref": "#/components/responses/Nedostupne"
          },
          "429": {
            "description": "Příliš mnoho objednávek; hlavička Retry-After"
          }
        }
      }
    },
    "/order-form.js": {
      "get": {
        "summary": "Hotový formulář objednávky k vložení na web",
        "description": "`<div id=\"jobi-objednavka\"></div>` a `<script src=\"…/order-form.js?service=slug\"></script>`.\nBarvu přebijete CSS proměnnou `--jobi-akcent` na `.jobi-obj`.\n",
        "parameters": [
          {
            "$ref": "#/components/parameters/Service"
          }
        ],
        "responses": {
          "200": {
            "description": "JavaScript",
            "content": {
              "application/javascript": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "TokenApi": {
        "type": "http",
        "scheme": "bearer",
        "description": "Token vydá majitel nebo admin servisu v Nastavení → API. Ukáže se\njednou; v databázi je dál jen jeho otisk.\n"
      }
    },
    "parameters": {
      "Service": {
        "name": "service",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string"
        },
        "description": "Adresa servisu ve veřejném API (Nastavení → Základní údaje).",
        "example": "iswap-praha"
      },
      "IfNoneMatch": {
        "name": "If-None-Match",
        "in": "header",
        "required": false,
        "schema": {
          "type": "string"
        },
        "description": "ETag z minulé odpovědi. Když se nic nezměnilo, přijde 304."
      }
    },
    "headers": {
      "ETag": {
        "schema": {
          "type": "string"
        },
        "description": "Otisk obsahu. `generated_at` se do něj nepočítá."
      },
      "CacheControl": {
        "schema": {
          "type": "string"
        },
        "description": "public, max-age=300"
      }
    },
    "responses": {
      "ChybiService": {
        "description": "Chybí parametr service"
      },
      "Nedostupne": {
        "description": "Servis s tou adresou neexistuje, nebo nemá zapnutý příslušný modul.\nObojí vrací totéž schválně.\n"
      }
    },
    "schemas": {
      "Servis": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "slug": {
            "type": "string"
          }
        }
      },
      "Dph": {
        "type": "object",
        "description": "Podle čeho se dopočítávají varianty cen.",
        "properties": {
          "payer": {
            "type": "boolean",
            "description": "Je servis plátce DPH?"
          },
          "rate": {
            "type": "number",
            "description": "Sazba v procentech; u neplátce 0"
          },
          "prices_include_vat": {
            "type": "boolean",
            "description": "Zadává servis ceny včetně daně?"
          }
        }
      },
      "Ceny": {
        "type": "object",
        "description": "Cena ve třech podobách, ať si web vybere. Neplátce DPH má ve všech\ntřech stejnou hodnotu.\n",
        "properties": {
          "price": {
            "type": "number",
            "description": "Tak, jak ji servis zadává"
          },
          "price_incl_vat": {
            "type": "number"
          },
          "price_excl_vat": {
            "type": "number"
          }
        }
      },
      "Katalog": {
        "type": "object",
        "properties": {
          "service": {
            "$ref": "#/components/schemas/Servis"
          },
          "vat": {
            "$ref": "#/components/schemas/Dph"
          },
          "brands": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string"
                }
              }
            }
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "brand_id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string"
                }
              }
            }
          },
          "models": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "category_id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string"
                }
              }
            }
          },
          "repairs": {
            "type": "array",
            "items": {
              "allOf": [
                {
                  "$ref": "#/components/schemas/Ceny"
                },
                {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "name": {
                      "type": "string"
                    },
                    "details": {
                      "type": "string"
                    },
                    "estimated_time": {
                      "type": "integer",
                      "description": "Minuty"
                    },
                    "estimated_time_label": {
                      "type": "string",
                      "description": "Totéž pro člověka – „2 hodiny“, „3 dny“.",
                      "example": "2 hodiny"
                    },
                    "model_ids": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "format": "uuid"
                      },
                      "description": "Jen modely, které jsou samy veřejné. Oprava, která\nzbyla bez jediného veřejného modelu, se neposílá vůbec.\n"
                    }
                  }
                }
              ]
            }
          },
          "generated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Sklad": {
        "type": "object",
        "properties": {
          "service": {
            "$ref": "#/components/schemas/Servis"
          },
          "vat": {
            "$ref": "#/components/schemas/Dph"
          },
          "availability_mode": {
            "type": "string",
            "enum": [
              "hidden",
              "boolean",
              "exact"
            ],
            "description": "Co servis o dostupnosti prozrazuje. Volí se v Nastavení → API."
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string"
                }
              }
            }
          },
          "products": {
            "type": "array",
            "items": {
              "allOf": [
                {
                  "$ref": "#/components/schemas/Ceny"
                },
                {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "category_id": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "format": "uuid"
                    },
                    "name": {
                      "type": "string"
                    },
                    "sku": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "description": {
                      "type": "string"
                    },
                    "image_url": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "model_ids": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "format": "uuid"
                      }
                    },
                    "availability": {
                      "oneOf": [
                        {
                          "type": "string",
                          "enum": [
                            "in_stock",
                            "out_of_stock"
                          ]
                        },
                        {
                          "type": "integer"
                        }
                      ],
                      "description": "Chybí úplně, když je režim `hidden` – schválně se\nneposílá null, ať web nemusí rozlišovat „nevíme“\nod „není skladem“.\n"
                    }
                  }
                }
              ]
            }
          },
          "generated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Zapis": {
        "type": "object",
        "minProperties": 1,
        "properties": {
          "products": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "description": "Úprava se adresuje přes `id` nebo `sku`. `create: true` založí nový\nprodukt (`name` povinné, `sku` volitelné, `stock` jde rovnou do skladu).\n`delete: true` smaže produkt podle `id` včetně zásoby a rezervací.\n",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "sku": {
                  "type": "string"
                },
                "create": {
                  "type": "boolean"
                },
                "delete": {
                  "type": "boolean"
                },
                "name": {
                  "type": "string",
                  "maxLength": 200
                },
                "description": {
                  "type": "string",
                  "maxLength": 2000
                },
                "stock": {
                  "type": "integer",
                  "minimum": 0
                },
                "warehouse": {
                  "type": "string",
                  "description": "Id nebo název skladu pro `stock`; bez něj výchozí sklad"
                },
                "price": {
                  "type": "number",
                  "minimum": 0
                },
                "purchase_price": {
                  "type": "number",
                  "minimum": 0
                },
                "min_stock": {
                  "type": "integer",
                  "minimum": 0
                },
                "supplier_sku": {
                  "type": "string",
                  "maxLength": 80
                },
                "category_id": {
                  "type": "string",
                  "format": "uuid",
                  "nullable": true,
                  "description": "Kategorie skladu"
                },
                "model_ids": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid"
                  }
                },
                "public_visible": {
                  "type": "boolean"
                }
              }
            }
          },
          "repairs": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "description": "Úprava se adresuje jen přes `id` – „Výměna displeje“ má servis\nu každého modelu jinou. Bez `id` a s `name` se založí nová oprava\n(`model_ids` povinné). `delete: true` smaže opravu podle `id`.\n",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "delete": {
                  "type": "boolean"
                },
                "name": {
                  "type": "string",
                  "maxLength": 200
                },
                "details": {
                  "type": "string",
                  "maxLength": 2000
                },
                "price": {
                  "type": "number",
                  "minimum": 0
                },
                "costs": {
                  "type": "number",
                  "minimum": 0
                },
                "estimated_time": {
                  "type": "integer",
                  "minimum": 0
                },
                "model_ids": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid"
                  }
                },
                "product_ids": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid"
                  }
                },
                "public_visible": {
                  "type": "boolean"
                }
              }
            }
          },
          "brands": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "description": "Bez `id` se založí, s `id` přejmenuje. Mazání jen v aplikaci.",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string",
                  "maxLength": 120
                },
                "public_visible": {
                  "type": "boolean"
                }
              }
            }
          },
          "categories": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "description": "Kategorie zařízení pod značkou (`brand_id` povinné u nové).",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string",
                  "maxLength": 120
                },
                "brand_id": {
                  "type": "string",
                  "format": "uuid"
                },
                "public_visible": {
                  "type": "boolean"
                }
              }
            }
          },
          "models": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "description": "Model pod kategorií (`category_id` povinné u nového).",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string",
                  "maxLength": 160
                },
                "category_id": {
                  "type": "string",
                  "format": "uuid"
                },
                "public_visible": {
                  "type": "boolean"
                }
              }
            }
          }
        }
      },
      "VysledekZapisu": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          },
          "products": {
            "$ref": "#/components/schemas/PocetZmen"
          },
          "repairs": {
            "$ref": "#/components/schemas/PocetZmen"
          },
          "brands": {
            "$ref": "#/components/schemas/PocetZmen"
          },
          "categories": {
            "$ref": "#/components/schemas/PocetZmen"
          },
          "models": {
            "$ref": "#/components/schemas/PocetZmen"
          },
          "errors": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Je tam jen když něco neprošlo. Odpověď má pak stav 207."
          }
        }
      },
      "PocetZmen": {
        "type": "object",
        "properties": {
          "updated": {
            "type": "integer"
          },
          "created": {
            "type": "integer"
          },
          "deleted": {
            "type": "integer"
          },
          "created_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Id nově založených záznamů v pořadí, v jakém byly v požadavku."
          },
          "not_found": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Položky, které v tomhle servisu nejsou. Cizí id se chová stejně\njako neexistující – přes API nejde zjišťovat cizí data.\n"
          }
        }
      },
      "Objednavka": {
        "type": "object",
        "required": [
          "external_id"
        ],
        "description": "Mění se jen poslaná pole. Text se ořízne o mezery; prázdný text = smazat.\nVazby (`branch_id`, `device.model_id`, `repair_id`) se přijmou jen na\nzáznamy tohoto servisu – cizí id se vynechá a ohlásí v `errors`.\n",
        "properties": {
          "external_id": {
            "type": "string",
            "maxLength": 100,
            "description": "Číslo objednávky ve vašem systému (SRV-2026-0123). Jedinečné v servisu."
          },
          "status": {
            "type": "string",
            "enum": [
              "new",
              "in_transit",
              "arrived",
              "cancelled"
            ]
          },
          "source": {
            "type": "string",
            "maxLength": 80,
            "description": "Odkud objednávka je (web, e-shop). Bez něj název tokenu."
          },
          "branch_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid",
            "description": "Pobočka servisu, kam zařízení jede."
          },
          "customer": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "maxLength": 200
              },
              "phone": {
                "type": "string",
                "maxLength": 40
              },
              "email": {
                "type": "string",
                "format": "email",
                "maxLength": 200
              },
              "company": {
                "type": "string",
                "maxLength": 200
              },
              "ico": {
                "type": "string",
                "maxLength": 20
              },
              "dic": {
                "type": "string",
                "maxLength": 20
              },
              "address": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "street": {
                        "type": "string",
                        "maxLength": 200
                      },
                      "city": {
                        "type": "string",
                        "maxLength": 120
                      },
                      "zip": {
                        "type": "string",
                        "maxLength": 20
                      }
                    }
                  }
                ]
              }
            }
          },
          "device": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Zařízení (model) tak, jak ho zadal zákazník"
                  },
                  "model_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "Model z ceníku (`/catalog` → models[].id) – má přednost při příjmu"
                  },
                  "serial": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "Sériové číslo nebo IMEI (jde i jako `imei`)"
                  },
                  "passcode": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "Heslo / kód obrazovky"
                  },
                  "accessories": {
                    "type": "string",
                    "maxLength": 500
                  }
                }
              }
            ]
          },
          "issue": {
            "type": "string",
            "maxLength": 4000,
            "description": "Popis závady"
          },
          "requested_repair": {
            "type": "string",
            "maxLength": 1000,
            "description": "Požadovaná oprava"
          },
          "repair_id": {
            "type": "string",
            "format": "uuid",
            "description": "Oprava z ceníku – při příjmu se přidá i s cenou"
          },
          "shipping": {
            "type": "object",
            "properties": {
              "inbound": {
                "type": "string",
                "maxLength": 100,
                "description": "Doprava do servisu (DPD, Zásilkovna, osobně)"
              },
              "outbound": {
                "type": "string",
                "maxLength": 100,
                "description": "Doprava zpět"
              },
              "pickup_point": {
                "description": "Výdejní místo pro vrácení (text nebo objekt id/name/street/city/zip)",
                "oneOf": [
                  {
                    "type": "string",
                    "maxLength": 500
                  },
                  {
                    "type": "object"
                  }
                ]
              },
              "return_address": {
                "oneOf": [
                  {
                    "type": "string",
                    "maxLength": 500
                  },
                  {
                    "type": "object"
                  }
                ]
              },
              "tracking": {
                "type": "array",
                "maxItems": 20,
                "description": "Celý seznam sledovacích čísel (nahradí uložený). Bez `carrier` se dopravce odhadne z `inbound`/`outbound`.",
                "items": {
                  "oneOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "object",
                      "required": [
                        "number"
                      ],
                      "properties": {
                        "carrier": {
                          "type": "string",
                          "description": "dpd, zasilkovna, ppl, gls, ceska_posta, balikovna – nebo název"
                        },
                        "number": {
                          "type": "string",
                          "maxLength": 60
                        },
                        "direction": {
                          "type": "string",
                          "enum": [
                            "inbound",
                            "outbound"
                          ]
                        },
                        "url": {
                          "type": "string",
                          "description": "Vlastní odkaz na sledování (https); jinak ho Jobi sestaví podle dopravce"
                        }
                      }
                    }
                  ]
                }
              }
            }
          },
          "consent": {
            "$ref": "#/components/schemas/Souhlas"
          },
          "note": {
            "type": "string",
            "maxLength": 4000
          },
          "data": {
            "type": "object",
            "description": "Cokoli dalšího (cena dopravy, číslo platby…), nejvýš 20 kB. Jobi to jen uloží."
          }
        }
      },
      "Souhlas": {
        "type": [
          "object",
          "null"
        ],
        "required": [
          "id",
          "signed_at"
        ],
        "description": "Elektronické odsouhlasení zakázkového listu zákazníkem na vašem webu.\nPři založení zakázky se přenese na zakázku a vytiskne se na zakázkovém\nlistu v kolonce podpisu převzetí: s obrázkem podpisu obrázek, jinak\n„Elektronicky odsouhlaseno 13. 10. 2026 14:32 · ID … · formulář …“.\nJobi je jen kopie – důkaz (přesné znění, které zákazník viděl, a log\nodsouhlasení) si uchovejte u sebe, viz docs/API_OBJEDNAVKY.md.\nStejné `id` poslané znovu nic nemění (ani obrázek se nenahraje znovu).\n",
        "properties": {
          "id": {
            "type": "string",
            "maxLength": 100,
            "description": "Vaše ID odsouhlasení – jedinečné, náhodné (UUID), ne pořadové číslo"
          },
          "signed_at": {
            "type": "string",
            "format": "date-time",
            "description": "Kdy zákazník odsouhlasil (ISO 8601 s časovou zónou)"
          },
          "method": {
            "type": "string",
            "enum": [
              "checkbox",
              "drawn",
              "sms_code",
              "email_code",
              "bankid",
              "other"
            ],
            "description": "Bez hodnoty: drawn, když je obrázek, jinak checkbox"
          },
          "signer_name": {
            "type": "string",
            "maxLength": 200
          },
          "ip": {
            "type": "string",
            "maxLength": 64,
            "description": "IP adresa zákazníka (IPv4/IPv6)"
          },
          "user_agent": {
            "type": "string",
            "maxLength": 500
          },
          "terms_version": {
            "type": "string",
            "maxLength": 100,
            "description": "Verze obchodních podmínek / reklamačního řádu"
          },
          "document_version": {
            "type": "string",
            "maxLength": 100,
            "description": "Verze textu zakázkového listu"
          },
          "text_hash": {
            "type": "string",
            "maxLength": 200,
            "description": "Otisk přesného textu, který zákazník odsouhlasil (např. sha256:…)"
          },
          "terms_url": {
            "type": "string",
            "description": "Odkaz na znění podmínek (https)"
          },
          "signature_image": {
            "type": "string",
            "description": "Podpis nakreslený na displeji: `data:image/png;base64,…` (nebo jpeg), nejvýš 200 kB,\nnebo https odkaz, odkud si ho Jobi stáhne. Uloží se do soukromého úložiště servisu.\n"
          }
        }
      },
      "VysledekObjednavek": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          },
          "orders": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "index": {
                  "type": "integer",
                  "description": "Pořadí v požadavku"
                },
                "external_id": {
                  "type": "string"
                },
                "result": {
                  "type": "string",
                  "enum": [
                    "created",
                    "updated",
                    "unchanged"
                  ]
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "new",
                    "in_transit",
                    "arrived",
                    "converted",
                    "cancelled"
                  ]
                },
                "ticket_code": {
                  "type": [
                    "string",
                    "null"
                  ]
                }
              }
            }
          },
          "errors": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Chyby po položkách („orders[1]: customer.email nevypadá platně“). Odpověď má pak stav 207."
          }
        }
      },
      "StavObjednavky": {
        "type": "object",
        "properties": {
          "external_id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "new",
              "in_transit",
              "arrived",
              "converted",
              "cancelled"
            ]
          },
          "source": {
            "type": [
              "string",
              "null"
            ]
          },
          "customer": {
            "type": "object",
            "properties": {
              "name": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "device": {
            "type": "object",
            "properties": {
              "name": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "tracking": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "carrier": {
                  "type": "string"
                },
                "number": {
                  "type": "string"
                },
                "direction": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "enum": [
                    "inbound",
                    "outbound",
                    null
                  ]
                },
                "url": {
                  "type": [
                    "string",
                    "null"
                  ]
                }
              }
            }
          },
          "consent": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string"
              },
              "signed_at": {
                "type": "string"
              },
              "method": {
                "type": "string"
              },
              "has_signature_image": {
                "type": "boolean"
              }
            }
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          },
          "arrived_at": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "converted_at": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "ticket_code": {
            "type": [
              "string",
              "null"
            ]
          },
          "ticket": {
            "$ref": "#/components/schemas/ZakazkaVeWebhooku"
          }
        }
      },
      "ZakazkaVeWebhooku": {
        "type": [
          "object",
          "null"
        ],
        "description": "Zakázka v Jobi, která z objednávky vznikla.",
        "properties": {
          "code": {
            "type": "string",
            "example": "IRPAZ2601527"
          },
          "status": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "example": "in_progress"
              },
              "label": {
                "type": "string",
                "example": "V opravě"
              },
              "is_final": {
                "type": "boolean",
                "description": "Koncový stav (vydáno, nevyzvednuto…)"
              }
            }
          },
          "total": {
            "type": "number",
            "description": "Cena zakázky v Kč (provedené opravy po slevě)"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Webhook": {
        "type": "object",
        "properties": {
          "event": {
            "type": "string",
            "enum": [
              "order.converted",
              "ticket.status_changed",
              "ticket.completed",
              "order.cancelled",
              "ping"
            ]
          },
          "external_id": {
            "type": "string"
          },
          "source": {
            "type": [
              "string",
              "null"
            ]
          },
          "order_status": {
            "type": "string",
            "enum": [
              "new",
              "in_transit",
              "arrived",
              "converted",
              "cancelled"
            ]
          },
          "ticket_code": {
            "type": [
              "string",
              "null"
            ]
          },
          "status": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "key": {
                "type": "string"
              },
              "label": {
                "type": "string"
              },
              "is_final": {
                "type": "boolean"
              }
            }
          },
          "total": {
            "type": [
              "number",
              "null"
            ]
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          },
          "test": {
            "type": "boolean",
            "description": "Jen u zkušebního webhooku (event ping)"
          }
        }
      }
    }
  },
  "webhooks": {
    "objednavka": {
      "post": {
        "summary": "Oznámení o objednávce a zakázce (POST na adresu z Nastavení → API)",
        "description": "Události: `order.converted` (z objednávky vznikla zakázka),\n`ticket.status_changed` (zakázka změnila stav), `ticket.completed`\n(zakázka přešla do koncového stavu), `order.cancelled` (servis\nobjednávku zrušil v Jobi), `ping` (tlačítko Poslat zkušební webhook).\n\nHlavičky: `X-Jobi-Event`, `X-Jobi-Delivery` (id doručení – stejné při\nopakování, podle něj poznáte duplicitu) a `X-Jobi-Signature:\nsha256=<hex HMAC-SHA256 surového těla tajemstvím webhooku>`.\n\nOvěření v Node.js:\n```js\nimport crypto from \"node:crypto\";\nconst ocekavany = \"sha256=\" + crypto.createHmac(\"sha256\", process.env.JOBI_WEBHOOK_SECRET).update(surovéTělo).digest(\"hex\");\nconst ok = ocekavany.length === podpis.length && crypto.timingSafeEqual(Buffer.from(ocekavany), Buffer.from(podpis));\n```\n\nOdpovězte 2xx do 10 s. Výpadek, 5xx, 408 a 429 Jobi zkusí znovu\n3× (po 1, 5 a 30 minutách); ostatní 4xx neopakuje.\n",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Webhook"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Přijato"
          }
        }
      }
    }
  }
} as const;

// GENEROVÁNO – needituj. Zdroj: docs/api/openapi.yaml
// Přegeneruj přes: npm run api:spec
export const POPIS = {
  "openapi": "3.1.0",
  "info": {
    "title": "Jobi – veřejné API servisu",
    "version": "1.0.0",
    "license": {
      "name": "Proprietární – součást aplikace Jobi"
    },
    "description": "Ceník oprav a sklad servisu pro použití na vlastním webu.\n\nČtení je veřejné a bez tokenu – token v JavaScriptu na stránce stejně\nnení tajemství a rozbíjel by cachování. Servis se identifikuje slugem\nv parametru `service`.\n\nZápis token vyžaduje (`Authorization: Bearer jobi_…`).\n\nCeník a sklad jsou samostatné moduly. Servis, který má zapnutý jen\njeden z nich, dostane u druhého 404 – stejně jako když slug neexistuje.\nJe to schválně: přes API nemá jít zjišťovat, které servisy existují.\n"
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
    "/write": {
      "post": {
        "summary": "Zápis cen, časů a počtu kusů",
        "description": "Mění se jen vyjmenované hodnoty. Názvy, popisy ani vazby na modely\npřes API měnit nejdou – to je úprava katalogu a patří do aplikace.\n\nLimit 30 zápisů za minutu na token.\n",
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
              "description": "Adresuje se přes `id` nebo `sku`; aspoň jedno je povinné.",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "sku": {
                  "type": "string"
                },
                "stock": {
                  "type": "integer",
                  "minimum": 0
                },
                "price": {
                  "type": "number",
                  "minimum": 0
                }
              }
            }
          },
          "repairs": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "description": "Adresuje se jen přes `id`. Názvem to nejde – „Výměna displeje“\nmá servis u každého modelu jinou.\n",
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "price": {
                  "type": "number",
                  "minimum": 0
                },
                "estimated_time": {
                  "type": "integer",
                  "minimum": 0
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
          "not_found": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Položky, které v tomhle servisu nejsou. Cizí id se chová stejně\njako neexistující – přes API nejde zjišťovat cizí data.\n"
          }
        }
      }
    }
  }
} as const;

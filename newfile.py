import random
import datetime

def date():
    return datetime.datetime.now().strftime("%Y-%m-%d")

def roll_dice():
    return [random.randint(1, 6) for _ in range(2)]

def zufallszahlen():
    return random.randint(1, 200)

# Beispielaufruf
print("Ergebnis des Würfels:", roll_dice())
print("Zufälliger Wert:", zufallszahlen())
print("Heute's Datum:", date())

import random

def roll_dice():
    return [random.randint(1, 6) for _ in range(2)]

def zufallszahl():
    return random.randint(1, 200)

# Beispielaufruf
print("Ergebnis des Würfels:", roll_dice())
print("Zufälliger Wert:", zufallszahl())

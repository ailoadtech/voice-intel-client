import random

def roll_dice():
    """Funktion, um einen Würfel zu werfen."""
    return random.randint(1, 6)

# Beispielaufruf
if __name__ == "__main__":
    result = roll_dice()
    print(f"Wurf: {result}")

import datetime

def get_weekday():
    return ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"][datetime.datetime.now().weekday()]

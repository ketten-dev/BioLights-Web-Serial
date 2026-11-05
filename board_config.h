#ifndef BOARD_CONFIG_H
#define BOARD_CONFIG_H

// Board-brede instellingen die geen sensor-eigenschap zijn — de I2C-bus is
// een bordkeuze, niet een sensor-keuze (zie spec §3.1). main.cpp beheert de
// levensduur (laden/opslaan naar flash via I2C_CONFIG|<khz>); drivers lezen
// dit alleen uit.
extern float g_i2c_speed_khz;

#endif

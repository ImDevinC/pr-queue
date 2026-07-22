import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#101318",
      paper: "#171b22",
    },
    primary: {
      main: "#95d7bb",
      contrastText: "#101318",
    },
    text: {
      primary: "#f5f3ef",
      secondary: "#a9b0bb",
    },
    error: {
      main: "#ff918b",
    },
    warning: {
      main: "#f0c779",
    },
    divider: "#303844",
  },
  typography: {
    fontFamily: '"Manrope", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 800,
      letterSpacing: "-0.07em",
      lineHeight: 0.95,
      fontSize: "clamp(42px, 7vw, 76px)",
    },
    h2: {
      fontWeight: 700,
      letterSpacing: "-0.035em",
      lineHeight: 1.25,
      fontSize: "clamp(18px, 3vw, 23px)",
    },
    body1: {
      fontSize: 16,
      lineHeight: 1.6,
    },
    body2: {
      fontSize: 13,
    },
    caption: {
      fontFamily: '"DM Mono", monospace',
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      fontSize: 11,
    },
    overline: {
      fontFamily: '"DM Mono", monospace',
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      fontSize: 11,
      fontWeight: 500,
    },
  },
  shape: {
    borderRadius: 14,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background:
            "radial-gradient(circle at 85% -10%, #243043 0, transparent 34rem), #101318",
          minWidth: 320,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: "#171b22e6",
          border: "1px solid #303844",
          boxShadow: "0 10px 35px #0000001a",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: '"DM Mono", monospace',
          fontSize: 10,
          borderRadius: 5,
          border: "1px solid #35404d",
          backgroundColor: "transparent",
          color: "#b9c0c9",
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontFamily: '"DM Mono", monospace',
          fontSize: 13,
          backgroundColor: "#101318",
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "#95d7bb",
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 6,
          fontFamily: '"DM Mono", monospace',
          fontSize: 12,
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          width: 22,
          height: 22,
          fontSize: 10,
          fontWeight: 800,
          backgroundColor: "#95d7bb",
          color: "#101318",
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: "1px solid #303844",
          backgroundColor: "#171b22",
          color: "#aeb6c1",
        },
      },
    },
  },
});

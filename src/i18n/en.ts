import type { Translations } from "./fa";

export const en: Translations = {
  setup: {
    title: "Personal Wealth Operating System — Initial Setup",
    subtitle: "Configure accounting currency, financial accounts, and opening balance without demo data",
    step1Title: "Step 1: Currency & Calendar Preference",
    step1Desc: "Select accounting currency for ledger balance and display currency for UI reporting.",
    accountingCurrencyLabel: "Ledger Accounting Currency",
    accountingCurrencyHelp: "Base currency used internally for normalized double-entry ledger calculations.",
    displayCurrencyLabel: "User Display Currency",
    displayCurrencyHelp: "Preferred currency for UI presentation. Does not change ledger values.",
    dateCalendarLabel: "Date Calendar Preference",
    dateCalendarJalali: "Persian (Jalali)",
    dateCalendarGregorian: "Gregorian",
    userNameLabel: "User / Family Name",
    userNamePlaceholder: "e.g., John & Family",

    step2Title: "Step 2: Chart of Accounts Creation",
    step2Desc: "Set up default personal asset and liability accounts.",
    mainBankAccount: "Primary Bank Account",
    cashWallet: "Cash Vault / Wallet",
    cryptoWallet: "Crypto Wallet (Cold/Hot)",
    goldHolding: "Gold Holdings",
    loanLiability: "Loan / Credit Liability",

    step3Title: "Step 3: Opening Balance Setup",
    step3Desc: "Enter existing wealth. Opening balances are posted via balanced double-entry journal entry.",
    openingBalanceHelp: "Opening balances are credited against Opening Balance Equity according to accounting rules.",
    cashAmount: "Cash & Bank Balance",
    cryptoAmount: "Crypto Amount (e.g., ETH)",
    goldAmount: "Gold Amount (grams)",

    step4Title: "Step 4: Preview & Confirm",
    step4Desc: "Review configuration and opening journal entry preview before finalizing setup.",
    previewTitle: "Opening Journal Entry Preview",
    debitLabel: "Debit (Asset Inflow)",
    creditLabel: "Credit (Opening Equity)",
    balancedCheck: "Opening Entry Balance: Equal & Balanced ✅",

    submitBtn: "Complete Setup & Launch PWOS",
    submitting: "Posting opening balances…",
    completedMessage: "Personal Wealth Operating System setup successfully completed.",
    alreadyCompleted: "System setup has already been completed.",
  },
  common: {
    back: "Back",
    next: "Next",
    save: "Save",
    error: "Error",
    success: "Success",
  },
};

import { FieldLabel } from "./FieldLabel.jsx";
import Checkbox from "../../../components/ui/Checkbox/Checkbox.jsx";

export function CheckboxField({ label, value, onChange }) {
  return (
    <div className="flex h-[41px] w-full items-center justify-between gap-[16px]">
      <FieldLabel optional>{label}</FieldLabel>
      <Checkbox
        checked={value}
        size="S"
        interactive
        aria-label={label}
        onCheckedChange={onChange}
      />
    </div>
  );
}

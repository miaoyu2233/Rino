import * as SelectPrimitive from "@radix-ui/react-select";
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { mergeClassNames } from "./class-names";

export interface SelectOption {
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
  value: string;
}

export interface SelectProps extends Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
  "children" | "defaultValue" | "onChange" | "value"
> {
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: ReactNode;
  value: string;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      className,
      disabled,
      onValueChange,
      options,
      placeholder,
      value,
      ...triggerProps
    },
    ref,
  ) {
    const optionHelpId = useId();
    const [highlightedValue, setHighlightedValue] = useState(value);
    const highlightedOption = options.find(
      (option) => option.value === highlightedValue,
    );
    const hasOptionHelp =
      highlightedOption?.description !== undefined &&
      highlightedOption.description !== null &&
      highlightedOption.description !== "";

    useEffect(() => {
      if (options.some((option) => option.value === value)) {
        setHighlightedValue(value);
      }
    }, [options, value]);

    return (
      <SelectPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        {...(disabled === undefined ? {} : { disabled })}
      >
        <SelectPrimitive.Trigger
          {...triggerProps}
          ref={ref}
          data-value={value === "" ? undefined : value}
          className={mergeClassNames("ui-select__trigger", className)}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon className="ui-select__trigger-icon" asChild>
            <ProductIcon icon="action.chevronDown" size="small" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal
          container={
            typeof document !== "undefined" ? document.body : undefined
          }
        >
          <SelectPrimitive.Content
            className="ui-select__content"
            position="popper"
            sideOffset={4}
            collisionPadding={12}
            data-has-option-help={hasOptionHelp ? "true" : undefined}
          >
            <SelectPrimitive.ScrollUpButton className="ui-select__scroll-button">
              <ProductIcon icon="action.chevronUp" size="small" />
            </SelectPrimitive.ScrollUpButton>
            <div className="ui-select__menu-layout">
              <SelectPrimitive.Viewport className="ui-select__viewport">
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    className="ui-select__item"
                    value={option.value}
                    aria-describedby={
                      option.description === undefined ||
                      highlightedValue !== option.value
                        ? undefined
                        : optionHelpId
                    }
                    onFocus={() => {
                      setHighlightedValue(option.value);
                    }}
                    onPointerMove={() => {
                      setHighlightedValue(option.value);
                    }}
                    {...(option.disabled === undefined
                      ? {}
                      : { disabled: option.disabled })}
                  >
                    <SelectPrimitive.ItemText>
                      {option.label}
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="ui-select__item-indicator">
                      <ProductIcon icon="action.check" size="small" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              {hasOptionHelp ? (
                <div
                  id={optionHelpId}
                  className="ui-select__option-help"
                  role="note"
                >
                  {highlightedOption.description}
                </div>
              ) : null}
            </div>
            <SelectPrimitive.ScrollDownButton className="ui-select__scroll-button">
              <ProductIcon icon="action.chevronDown" size="small" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  },
);

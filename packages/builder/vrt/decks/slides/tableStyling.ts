import { palette } from "./palette.js";

// ============================================================
// Page 40: Table style inheritance, banding, and border sides
// Tests: table/row/column text defaults, bandedRowFill + headerRows,
//        per-edge cell borders, cellBorderSides (all three values).
// ============================================================
export const page40TableStylingXml = `
<VStack w="100%" h="max" padding="40" gap="16" alignItems="stretch" backgroundColor="${palette.background}">
  <Text fontSize="26" color="${palette.charcoal}" bold="true">Page 40: Table Styling</Text>

  <VStack padding="14" backgroundColor="FFFFFF" border='{"color":"${palette.border}","width":1}' gap="8">
    <Text fontSize="13" bold="true">Inheritance (table → row → column → cell) + banding</Text>
    <Table defaultRowHeight="26" fontSize="12" color="${palette.charcoal}"
           cellBorder='{"color":"${palette.border}","width":1}'
           bandedRowFill="${palette.lightBlue}" headerRows="1">
      <Col w="180" />
      <Col w="150" textAlign="right" />
      <Col w="150" textAlign="right" color="${palette.navy}" />
      <Tr bold="true" backgroundColor="${palette.navy}" color="FFFFFF">
        <Td>Item</Td>
        <Td>Quantity</Td>
        <Td>Amount</Td>
      </Tr>
      <Tr><Td>Alpha</Td><Td>12</Td><Td>1,200</Td></Tr>
      <Tr><Td>Beta</Td><Td>34</Td><Td>3,400</Td></Tr>
      <Tr><Td>Gamma</Td><Td>56</Td><Td>5,600</Td></Tr>
      <Tr bold="true">
        <Td borderTop='{"color":"${palette.navy}","width":2}'>Total</Td>
        <Td borderTop='{"color":"${palette.navy}","width":2}'>102</Td>
        <Td borderTop='{"color":"${palette.navy}","width":2}'>10,200</Td>
      </Tr>
    </Table>
  </VStack>

  <HStack gap="16" alignItems="stretch">
    <VStack w="50%" padding="14" backgroundColor="FFFFFF" border='{"color":"${palette.border}","width":1}' gap="8">
      <Text fontSize="13" bold="true">cellBorderSides="no-outer-vertical"</Text>
      <Table defaultRowHeight="24" fontSize="11"
             cellBorder='{"color":"${palette.navy}","width":1}'
             cellBorderSides="no-outer-vertical">
        <Col w="110" /><Col w="110" /><Col w="110" />
        <Tr bold="true"><Td>A</Td><Td>B</Td><Td>C</Td></Tr>
        <Tr><Td>a1</Td><Td>b1</Td><Td>c1</Td></Tr>
        <Tr><Td colspan="2">wide</Td><Td>c2</Td></Tr>
      </Table>
    </VStack>
    <VStack w="50%" padding="14" backgroundColor="FFFFFF" border='{"color":"${palette.border}","width":1}' gap="8">
      <Text fontSize="13" bold="true">cellBorderSides="horizontal-only"</Text>
      <Table defaultRowHeight="24" fontSize="11"
             cellBorder='{"color":"${palette.navy}","width":1}'
             cellBorderSides="horizontal-only">
        <Col w="110" /><Col w="110" /><Col w="110" />
        <Tr bold="true"><Td>A</Td><Td>B</Td><Td>C</Td></Tr>
        <Tr><Td rowspan="2">tall</Td><Td>b1</Td><Td>c1</Td></Tr>
        <Tr><Td>b2</Td><Td>c2</Td></Tr>
      </Table>
    </VStack>
  </HStack>
</VStack>
`;
